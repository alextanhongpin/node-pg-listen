import cron from "node-cron";
import ExponentialBackoff from "./exponential-backoff.js";

export default class CronBackoff {
  constructor() {
    this.triggeredAt = Date.now();
    this.backoff = new ExponentialBackoff();
  }

  schedule(crontab, fn) {
    return cron.schedule("* * * * * *", async () => {
      if (
        this.backoff.attempts > 0 &&
        Date.now() < this.backoff.duration + this.triggeredAt
      ) {
        this.backoff.increment();
        return;
      }
      const executed = await fn();
      executed ? this.backoff.reset() : this.backoff.increment();
      this.triggeredAt = Date.now();
    });
  }
}
