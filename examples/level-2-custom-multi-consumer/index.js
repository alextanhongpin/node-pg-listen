// This example demonstrates handling events for multiple consumers,
// done by persisting each consumer state in postgres.

import cron from "node-cron";

import db from "../../db.js";
import migrate from "./repository/migrate.js";
import Consumer from "./consumer.js";
import EventRepository from "./repository/event.js";
import ConsumerRepository from "./repository/consumer.js";
import CronBackoff from "./cron.js";
import createUsers from "../../user-store.js";

try {
  const count = await migrate(db);
  console.log(`migrated ${count} table(s)`);
} catch (error) {
  console.log("migrationError: %s", error.message);
}

const eventRepository = new EventRepository(db);
const consumerRepository = new ConsumerRepository(db);
const john = new Consumer("john", { eventRepository, consumerRepository });
const alice = new Consumer("alice", { eventRepository, consumerRepository });

// Avoid hammering the database when there are no events.
// We can optionally reset the timer through pg.notify callback.
const backgroundTask1 = new CronBackoff().schedule("* * * * * *", () => {
  console.log("executing john task");
  return john.run();
});

// Note that having consumers processing payload at different speed will cause
// the events to accumulate. In the worst case scenario, if one of the consumer
// is not running, past events would never be deleted.
const backgroundTask2 = cron.schedule("*/5 * * * * *", () => {
  console.log("running a task every 5 seconds");
  alice.run();
});

db.on("notification", ({ channel, payload }) => {
  const event = JSON.parse(payload);
  console.log({ channel, event });
  // If we need real-time capability, this would be a good place to handle that
  // logic.
  // Else, we can also do lazy trigger (setting count here, if the count hits
  // the threshold, publish an event).
  // However, this is not a substitute for cron, because if any logic here
  // fails, the cron should recover it.
});

await db.query("LISTEN person_created");
await createUsers();

setTimeout(() => {
  // End background tasks before terminating the database connection.
  backgroundTask1.stop();
  backgroundTask2.stop();
  db.end();
}, 10_000);
