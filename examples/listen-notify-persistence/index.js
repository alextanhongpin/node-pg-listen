// This example demonstrates on handling events for a single consumer.

import db from "../../db.js";
import migrate from "./migrate.js";
import cron from "node-cron";

// NOTE: Perform migrations. Don't do this in production.
console.log("migrated", await migrate(db), "tables");

// NOTE: We need a cron to retry failed events.
// In multi-instance deployment, run this only if the instance is leader.
const backgroundTask = cron.schedule("* * * * * *", () => {
  // When the application starts, we run a cron to query the events in the
  // `event` table to handle unprocessed events.
  // We can do a batch query, and once it is completed, we can delete the
  // unprocessed events.
  console.log("running a task every second");
  //batch();
  stream();
});

async function batch() {
  console.log("running batch processing");
  // We don't need to process it in transaction, since we are only working with
  // past events, unless we are running it in multiple nodes.
  const { rows: events } = await db.query("SELECT * FROM event LIMIT $1", [
    1000
  ]);
  if (!events.length) return;
  let lastId = 0;
  events.forEach(event => {
    console.log("processing", event);
    lastId = event.id;
  });
  await db.query(`DELETE FROM event WHERE id <= $1`, [lastId]);
}

async function stream() {
  console.log("running stream processing");
  try {
    const countResult = await db.query(`SELECT count(*) AS count FROM event`);
    const count = Number(countResult.rows[0].count);
    if (!count) {
      console.log("no event", count);
      return;
    }
    await db.query("BEGIN");
    // Take any unprocessed event that has not yet been locked. We can also select multiple.
    const { rows } = await db.query(
      "SELECT * FROM event LIMIT 1 FOR UPDATE SKIP LOCKED"
    );
    const event = rows[0];
    if (!event) {
      await db.query("COMMIT");
      return;
    }
    // Process event.
    console.log("processing unprocessed event", event);
    const result = await db.query("DELETE FROM event WHERE id = $1", [
      event.id
    ]);
    console.log("Deleted", result.rowCount);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

db.on("notification", async ({ channel, payload }) => {
  const event = JSON.parse(payload);
  // 1) Process the event.
  // 2) Delete the event after processing.

  // NOTE: Since we can have multiple db.on("notification"), we will receive
  // the message multiple times. This implementation is not robust.
  //await this.db.query(`DELETE FROM event WHERE id = $1`, [event.id])

  // An alternative is to just wrap the operation in a transaction.
  // But this means we still can only have one handler for notification.
  try {
    await db.query("BEGIN");
    await db.query("SELECT * FROM event WHERE id = $1 FOR UPDATE", [event.id]);
    // Process event.
    console.log("processing event", event.id);
    const result = await db.query("DELETE FROM event WHERE id = $1", [
      event.id
    ]);
    console.log("Deleted", result.rowCount);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
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
    SELECT * FROM person_created, pg_notify('person_created', (SELECT row_to_json(event_created.*) FROM event_created)::text);`,
    [name]
  );
});

setTimeout(() => {
  backgroundTask.stop();
  db.end();
}, 10_000);
