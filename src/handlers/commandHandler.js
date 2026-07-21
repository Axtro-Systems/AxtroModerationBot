import { Collection, REST, Routes } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class CommandHandler {
  constructor(client) {
    this.client = client;
    client.commands = new Collection();
    client.cooldowns = new Collection();
    this.globalRateLimit = new Map();

    
    setInterval(() => {
      const now = Date.now();
      for (const [userId, hits] of this.globalRateLimit) {
        const recent = hits.filter(t => now - t < 10000);
        if (recent.length === 0) {
          this.globalRateLimit.delete(userId);
        } else {
          this.globalRateLimit.set(userId, recent);
        }
      }
    }, 30000).unref();
  }

  async registerCommand(command) {
    this.client.commands.set(command.data.name, command);
  }

  async deployCommands() {
    const allCommands = [...this.client.commands.values()].sort((a, b) => a.data.name.localeCompare(b.data.name));
    const commandsJson = allCommands.map(c => {
      const json = c.data.toJSON();
      // Force default_member_permissions to null so Discord exposes slash commands to ALL members
      json.default_member_permissions = null;
      json.dm_permission = true;
      return json;
    });

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
      // 1. Wipe stale per-guild command permission locks stored on Discord servers
      if (config.guildId) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
        logger.info(`Cleared stale guild command permission locks for ${config.guildId}`);
      }

      // 2. Deploy all commands globally for @everyone
      await rest.put(Routes.applicationCommands(config.clientId), { body: commandsJson });
      logger.info(`Successfully deployed ${commandsJson.length} global commands for @everyone`);

      // 3. Re-deploy clean commands to primary guild for instant sync
      if (config.guildId) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandsJson });
        logger.info(`Successfully synchronized ${commandsJson.length} guild commands`);
      }
    } catch (err) {
      const details = err.rawBody?.errors ? JSON.stringify(err.rawBody.errors) : err.message;
      logger.error(`Failed to deploy commands: ${details}`);
    }
  }

  async handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = this.client.commands.get(interaction.commandName);
    if (!command) return;

    if (command.defer !== false && !interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: command.ephemeral !== false });
      } catch (err) {
        logger.warn(`Failed to auto-defer /${interaction.commandName}: ${err.message}`);
        return;
      }
    }

    const globalKey = interaction.user.id;
    const now = Date.now();
    const userHits = this.globalRateLimit.get(globalKey) || [];
    const recentHits = userHits.filter(t => now - t < 5000);
    if (recentHits.length >= 10) {
      const rateLimitMsg = {
        content: 'You are using commands too quickly. Please slow down.',
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp(rateLimitMsg).catch(() => {});
      }
      return interaction.reply(rateLimitMsg).catch(() => {});
    }
    recentHits.push(now);
    this.globalRateLimit.set(globalKey, recentHits);

    const cooldownKey = `${interaction.user.id}-${interaction.commandName}`;
    const cooldown = command.cooldown || 0;
    if (cooldown > 0) {
      const timestamps = this.client.cooldowns;
      if (timestamps.has(cooldownKey)) {
        const expiration = timestamps.get(cooldownKey) + cooldown;
        if (now < expiration) {
          const remaining = (expiration - now) / 1000;
          const cooldownMsg = {
            content: `Please wait ${remaining.toFixed(1)}s before using this command again.`,
            ephemeral: true,
          };
          if (interaction.deferred || interaction.replied) {
            return interaction.followUp(cooldownMsg).catch(() => {});
          }
          return interaction.reply(cooldownMsg).catch(() => {});
        }
      }
      timestamps.set(cooldownKey, now);
      setTimeout(() => timestamps.delete(cooldownKey), cooldown);
    }

    const originalEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = async (options) => {
      if (interaction.deferred || interaction.replied) {
        return await originalEditReply(options);
      } else {
        return await interaction.reply(options);
      }
    };

    try {
      await command.execute(interaction, this.client);
    } catch (err) {
      logger.error(`Command error [${interaction.commandName}]: ${err.message}`, err);
      const reply = {
        content: 'An error occurred while executing this command.',
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
}
