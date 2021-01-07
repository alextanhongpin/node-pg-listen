export default class Consumer {
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
