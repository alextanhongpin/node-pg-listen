// This example demonstrates on handling events for a single consumer.

import cron from "node-cron";
import db from "../../db.js";
import migrate from "./migrate.js";
import createUsers from "../../user-store.js";

// NOTE: Perform migrations. Don't do this in production.
console.log("migrated", await migrate(db), "tables");

// NOTE: Run a cron to retry failed events. In multi-instance deployment, run this only if the instance is the leader.
const backgroundTask = cron.schedule("*/3 * * * * *", () => {
  console.log("running a task every 3 seconds");
  batch();
  //stream();
});

function handle(event) {
  console.log("processing", event);
}

async function batch() {
  console.log("running batch processing");
  // Process in transaction to ensure another running query won't process the
  // same work.
  let lastId = 0;
  try {
    await db.query("BEGIN");
    const { rows: events } = await db.query(
      "SELECT * FROM event ORDER BY id LIMIT 1000 FOR UPDATE"
    );

    // Handle or publish event.
    for (let event of events) {
      await handle(event);
      lastId = event.id;
    }

    await db.query(`DELETE FROM event WHERE id <= $1`, [lastId]);

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    console.log("batchError:", error.message);
  }
}

async function stream(event) {
  console.log("running stream processing");
  try {
    await db.query("BEGIN");
    // Take any unprocessed event that has not yet been locked. We can also select multiple.
    const { rows } = await db.query(
      ...(event?.id
        ? [
            "SELECT * FROM event WHERE id = $1 LIMIT 1 FOR UPDATE NOWAIT",
            [event.id]
          ]
        : ["SELECT * FROM event ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED"])
    );
    const storedEvent = rows?.[0];
    if (!storedEvent) {
      await db.query("COMMIT");
      return;
    }
    await handle(event);

    const result = await db.query("DELETE FROM event WHERE id = $1", [
      storedEvent.id
    ]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

// NOTE: Since we can have multiple db.on("notification"), we will receive
// the message multiple times. This implementation is not robust.
db.on("notification", ({ channel, payload }) => {
  const event = JSON.parse(payload);
  stream(event);
});

await db.query("LISTEN person_created");

createUsers(db);

setTimeout(() => {
  backgroundTask.stop();
  db.end();
}, 10_000);
