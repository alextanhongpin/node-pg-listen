// This example demonstrates sending the events to redis-stream and handling with a single consumer.

import cron from "node-cron";
import Redis from "ioredis";
import db from "../../db.js";
import migrate from "./migrate.js";
import createUsers from "../../user-store.js";
import EventStore from "./event-store.js";
import ConsumerStore from "./consumer-store.js";

const STREAM_KEY = "mystream"; // TODO: Use $ to indicate stream?

await migrate(db);

const redis = new Redis();
await redis.flushall();

const eventStore = new EventStore(db);
const consumerStore = new ConsumerStore(db);

const processEvents = cron.schedule("*/5 * * * * *", () => {
  console.log("running a task every 5 seconds");
  sendEventToRedisStream();
});

const consumeRedis = cron.schedule("*/5 * * * * *", () => {
  redisConsumerGroup();
});

async function redisConsumerGroup() {
  const consumerName = "john";
  const consumer = await consumerStore.upsert(consumerName);
  let lastEventId = consumer.last_event_id;
  let lastRedisId = consumer.last_redis_id || "-";
  console.log("redis consumer", { lastEventId, lastRedisId });
  try {
    const records = await redis.xrange(
      STREAM_KEY,
      lastRedisId,
      "+",
      "COUNT",
      1000
    );
    if (!records) return;
    records.forEach(record => {
      const [redisId, fields] = record;
      const event = {};
      for (let i = 0; i < fields.length; i += 2) {
        event[fields[i]] = fields[i + 1];
      }
      event.id = BigInt(event.id);
      if (event.id <= lastEventId) {
        console.log("skipping", lastEventId, event.id);
        return;
      }
      // Do work...
      console.log("performing work", { event, redisId });
      lastRedisId = redisId;
      lastEventId = event.id;
    });
    await consumerStore.updateLastCheckpoint(
      consumerName,
      lastEventId,
      lastRedisId
    );
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
        event.id
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

createUsers(db);

setTimeout(() => {
  // End background tasks before terminating the database connection.
  processEvents.stop();
  consumeRedis.stop();
  redis.end();
  db.end();
}, 15_000);
