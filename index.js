import { EventEmitter } from "events";
import cron from "node-cron";

import db from "./db.js";
import migrate from "./repository/migrate.js";
import EventRepository from "./repository/event.js";
import ConsumerRepository from "./repository/consumer.js";

try {
  const count = await migrate(db);
  console.log(`migrated ${count} table(s)`);
} catch (error) {
  console.log("migrationError: %s", error.message);
}

class ExponentialBackoff {
  constructor() {
    this.durations = Array(10)
      .fill(0)
      .map((_, i) => Math.pow(2, i) * 1000);
    this.attempts = 0;
  }

  duration() {
    const duration = this.durations[
      Math.min(this.attempts, this.durations.length - 1)
    ];
    return Math.floor(duration / 2 + Math.random() * duration);
  }

  reset() {
    this.attempts = 0;
  }

  increment() {
    this.attempts++;
  }
}

class Consumer {
  // Give a unique name to the consumer.

  BATCH_SIZE = 1000;
  constructor(name, { eventRepository, consumerRepository }) {
    this.name = name;
    this.consumerRepository = consumerRepository;
    this.eventRepository = eventRepository;

    this.consumerRepository.upsert(name);
  }

  createTopicChecker(consumer) {
    const allTopics = consumer.topics.includes("*");
    const topics = new Map(consumer.topics.map(topic => [topic, true]));
    return topic => {
      return allTopics || topics.has(topic);
    };
  }

  async run() {
    const consumer = await this.consumerRepository.upsert(this.name);
    const checkTopic = this.createTopicChecker(consumer);
    let lastCheckpoint = consumer.checkpoint;

    const events = await this.eventRepository.findAll(
      lastCheckpoint,
      this.BATCH_SIZE
    );
    if (!events.length) {
      console.log("no events to process");
      return false;
    }
    for await (let event of events) {
      try {
        // Subscribed to that particular topic.
        if (checkTopic(event.event)) {
          console.log("%s: processing event...", consumer.name);
        } else {
          console.log("skipping event");
        }
        lastCheckpoint = event.id;
      } catch (error) {
        console.log(event, error);
        break;
      }
    }

    const updated = await this.consumerRepository.updateLastCheckpoint(
      consumer.name,
      lastCheckpoint
    );
    console.log("updated last checkpoint:", updated);
    const minCheckpointToClear = await this.consumerRepository.minCheckpoint();

    const truncated = await this.eventRepository.truncate(minCheckpointToClear);
    console.log("%s: truncated %d", consumer.name, truncated);
    return truncated;
  }
}

const eventRepository = new EventRepository(db);
const consumerRepository = new ConsumerRepository(db);
const john = new Consumer("john", { eventRepository, consumerRepository });
const alice = new Consumer("alice", { eventRepository, consumerRepository });
const exp = new ExponentialBackoff();
let johnLastRun = Date.now();

const backgroundTask1 = cron.schedule("* * * * * *", async () => {
  console.log("running a task every second", exp);
  if (exp.attempts > 0 && Date.now() < exp.duration() + johnLastRun) {
    exp.increment();
    console.log("increment");
    return;
  }
  console.log("running john");
  const hasEvents = await john.run();
  johnLastRun = Date.now();
  if (hasEvents) {
    exp.reset();
  } else {
    exp.increment();
  }
});

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
  // End background tasks before terminating the database connection.
  backgroundTask1.stop();
  backgroundTask2.stop();
  db.end();
}, 10_000);
