import { logger } from '../utils/logger.js';
import { GuildModel } from '../models/Guild.js';

export class EventHandler {
  constructor(client) {
    this.client = client;
  }

  async registerEvent(eventFile) {
    const event = eventFile;
    const eventName = event.name;
    if (event.once) {
      this.client.once(eventName, (...args) => event.execute(...args, this.client));
    } else {
      this.client.on(eventName, (...args) => event.execute(...args, this.client));
    }
    return eventName;
  }

  async cacheGuildConfig(guildId) {
    try {
      let config = this.client.guildConfigs?.get(guildId);
      if (!config) {
        config = await GuildModel.findOneAndUpdate(
          { guildId },
          { $setOnInsert: { guildId } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
        if (!this.client.guildConfigs) this.client.guildConfigs = new Map();
        this.client.guildConfigs.set(guildId, config);
      }
      return config;
    } catch (err) {
      logger.error(`Failed to cache guild config for ${guildId}: ${err.message}`);
      return null;
    }
  }

  invalidateGuildConfig(guildId) {
    this.client.guildConfigs?.delete(guildId);
  }
}
