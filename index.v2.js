// This example demonstrates on handling events for a single consumer.

import { EventEmitter } from "events";
import db from "./db.js";
import cron from "node-cron";

// In multi-instance deployment, run this only if the instance is leader.
const backgroundTask = cron.schedule("* * * * * *", () => {
  // When the application starts, we run a cron to query the events in the
  // `event` table to handle unprocessed events.
  // We can do a batch query, and once it is completed, we can delete the
  // unprocessed events.
  console.log("running a task every second");
  console.log("checking for unprocessed events");
});

class PersonCreatedEventHandler extends EventEmitter {
  static EVENT = "person_created";

  constructor(db) {
    super();
    this.db = db;
    this.on(PersonCreatedEventHandler.EVENT, event => this.exec(event));
  }

  async exec(event) {
    // NOTE: This assumes that there are only one consumer interested in the
    // event. If we are handling multi consumer, we need a better way to
    // handle the event. Other thoughts:
    // - single/multi consumer?
    // - single delivery/batch delivery?
    // - real-time/cron?

    // Do something...
    console.log("processing event: ", event);

    // Remove the event once it is completed.
    const result = await this.db.query(
      `
      DELETE
      FROM event 
      WHERE id = $1
    `,
      [event.id]
    );
    // If this operation fails, it should be handled in the background cron.
    console.log("Deleted", result.rowCount);
  }
}

// NOTE: Perform migrations. Don't do this in production.
const result = await db.query(`
  CREATE TABLE IF NOT EXISTS person (
    id uuid DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS event (
    id bigint GENERATED ALWAYS AS IDENTITY,
    event text NOT NULL,
    object text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
  );
`);
console.log(result.length);

const personCreatedEventHandler = new PersonCreatedEventHandler(db);
db.on("notification", ({ channel, payload }) => {
  const event = JSON.parse(payload);
  switch (channel) {
    case PersonCreatedEventHandler.EVENT:
      personCreatedEventHandler.emit(channel, event);
      break;
    default:
      throw new Error(`not implemented: ${channel}`);
  }
});

await db.query("LISTEN person_created");

"abcdefghijklmnopqrstuvwxyz".split("").forEach(name => {
  // This works as a transaction, if one of the WITH step fails, all of them fails.
  db.query(
    `WITH person_created AS (
      INSERT INTO person(name) VALUES ($1) RETURNING *
    ),
    event_created AS (
      INSERT INTO event (object, event, data) VALUES ('person', 'person_created', (SELECT row_to_json(person_created.*) FROM person_created))
      RETURNING *
    )
    SELECT pg_notify('person_created', (SELECT row_to_json(event_created.*) FROM event_created)::text);`,
    [name]
  );
});

setTimeout(() => {
  backgroundTask.stop();
  db.end();
}, 10_000);
