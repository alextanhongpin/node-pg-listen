// This example demonstrates sending the events to redis-stream and handling with a multiple consumer.

import cron from "node-cron";
import Redis from "ioredis";
import db from "../../db.js";
import migrate from "../redis-stream/migrate.js";
import createUser from "../redis-stream/user-store.js";
import EventStore from "../redis-stream/event-store.js";

const STREAM_KEY = "mystream";
const GROUP_KEY = "mygroup";

await migrate(db);

const redis = new Redis();
await redis.flushall();

const eventStore = new EventStore(db);

// Create consumer group.
await redis.xgroup("CREATE", STREAM_KEY, GROUP_KEY, "$", "MKSTREAM");

const processEvents = cron.schedule("*/3 * * * * *", () => {
  console.log("running a task every 3 seconds");
  sendEventToRedisStream();
});

const consumeRedis = cron.schedule("*/3 * * * * *", () => {
  // Jobs will be distributed between john and alice.
  redisConsumerGroup("john");
  redisConsumerGroup("alice");
});

async function redisConsumerGroup(consumerKey) {
  try {
    const streams = await redis.xreadgroup(
      "GROUP",
      GROUP_KEY,
      consumerKey,
      "COUNT",
      10,
      "STREAMS",
      STREAM_KEY,
      ">"
    );
    if (!streams) return;
    streams.forEach(stream => {
      const [streamName, records] = stream;
      records.forEach(record => {
        const [redisId, fields] = record;
        const event = {};
        for (let i = 0; i < fields.length; i += 2) {
          try {
            event[fields[i]] = JSON.parse(fields[i + 1]);
          } catch (error) {
            event[fields[i]] = fields[i + 1];
          }
        }
        event.id = BigInt(event.id);
        // Do work...
        console.log(consumerKey, "performing work", { event, redisId });
      });
    });
  } catch (error) {
    console.log(error);
  }
}

async function sendEventToRedisStream() {
  // TODO: Wrap this in transaction?
  const events = await eventStore.findAll();
  let lastEventId = 0;
  for (let event of events) {
    try {
      // The returned value is a boolean, not a redis id...
      const redisId = await redis.xadd(
        STREAM_KEY, // Stream key.
        "*", // Auto-generate stream id.
        "id",
        event.id,
        "object",
        event.object,
        "data",
        JSON.stringify(event.data)
      );
      console.log("added to stream", { redisId, eventId: event.id });
      lastEventId = event.id;
    } catch (error) {
      console.log(error);
      break;
    }
  }
  await eventStore.truncate(lastEventId);
}

createUser(db);

setTimeout(() => {
  // End background tasks before terminating the database connection.
  processEvents.stop();
  consumeRedis.stop();
  redis.end();
  db.end();
}, 15_000);
