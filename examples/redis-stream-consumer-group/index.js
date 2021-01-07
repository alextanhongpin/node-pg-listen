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
try {
  await redis.xgroup("CREATE", STREAM_KEY, GROUP_KEY, "$", "MKSTREAM");
} catch (error) {
  if (error.message.startsWith("BUSYGROUP")) {
    console.log("consumer name already exists");
  } else {
    throw error;
  }
}

const processEvents = cron.schedule("*/3 * * * * *", () => {
  console.log("running a task every 3 seconds");
  sendEventToRedisStream();
});

const john = createConsumer("john");
const alice = createConsumer("alice");
const consumeRedis = cron.schedule("*/3 * * * * *", () => {
  // Jobs will be distributed between john and alice.
  john();
  alice();
});

function createConsumer(consumerKey) {
  let checkBacklog = true;
  return async () => {
    try {
      // When we recover from crash, process pending messages. Else, listen to new ones.
      let startId = checkBacklog ? 0 : ">";
      console.log("startId", checkBacklog, startId);
      const streams = await redis.xreadgroup(
        "GROUP",
        GROUP_KEY,
        consumerKey,
        "COUNT",
        10,
        "STREAMS",
        STREAM_KEY,
        startId
      );
      if (!streams) {
        return;
      }
      const [streamName, records] = streams[0];
      checkBacklog = !(records.length === 0);
      console.log("received from stream", { streamName });
      records.forEach(async record => {
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

        // Acknowledge.
        const ack = await redis.xack(STREAM_KEY, GROUP_KEY, redisId);
        console.log(ack);
      });
    } catch (error) {
      console.log(error);
    }
  };
}

async function sendEventToRedisStream() {
  // TODO: Wrap this in transaction?
  const events = await eventStore.findAll();
  let lastEventId = 0;
  for (let event of events) {
    try {
      // MAXLEN ~ 1,000,000 caps the stream at roughly that number, so that it
      // doesn't grow in an unbounded way. We might not need this if the stream
      // is truncated after ack.
      const redisId = await redis.xadd(
        STREAM_KEY, // Stream key.
        "MAXLEN",
        "~",
        1_000_000,
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
