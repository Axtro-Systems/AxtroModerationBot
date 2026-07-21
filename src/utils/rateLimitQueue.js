import { logger } from './logger.js';

class RateLimitQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.running = false;
  }

  addTask(taskFn) {
    this.queue.push(taskFn);
    this.start();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      try {
        await task();
      } catch (err) {
        logger.error(`[Queue ${this.guildId}] Task failed: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    this.running = false;
  }
}

const queues = new Map();

export function getGuildQueue(guildId) {
  let queue = queues.get(guildId);
  if (!queue) {
    queue = new RateLimitQueue(guildId);
    queues.set(guildId, queue);
  }
  return queue;
}
