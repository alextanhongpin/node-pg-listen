export default class ExponentialBackoff {
  constructor() {
    this.durations = Array(10)
      .fill(0)
      .map((_, i) => Math.pow(2, i) * 1000);
    this.attempts = 0;
  }

  get duration() {
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
