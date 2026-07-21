import { Client, GatewayIntentBits, Partials, EmbedBuilder, MessageFlags, TextChannel, ThreadChannel, DMChannel, AttachmentBuilder } from 'discord.js';
import mongoose from 'mongoose';
import http from 'http';
import { config } from './config.js';
import { connectMongo } from './mongo.js';
import { logger } from './utils/logger.js';
import { CommandHandler } from './handlers/commandHandler.js';
import { EventHandler } from './handlers/eventHandler.js';
import { GuildModel } from './models/Guild.js';
import nodeCron from 'node-cron';
import { setClient } from './utils/embed.js';
import { giveawayManager } from './utils/GiveawayManager.js';
import { handleGiveawayInteraction } from './handlers/giveawayHandler.js';


const classesToPatch = [TextChannel, ThreadChannel, DMChannel];
for (const cls of classesToPatch) {
  if (cls && cls.prototype && cls.prototype.send) {
    const origSend = cls.prototype.send;
    cls.prototype.send = async function (options) {
      if (options && typeof options === 'object') {
        if (options.embeds && Array.isArray(options.embeds)) {
          const usesLogo = options.embeds.some(emb => {
            const json = typeof emb.toJSON === 'function' ? emb.toJSON() : emb;
            return (json.footer?.icon_url?.startsWith('attachment://')) ||
                   (json.thumbnail?.url?.startsWith('attachment://')) ||
                   (json.author?.icon_url?.startsWith('attachment://'));
          });
          if (usesLogo) {
            options.files = options.files || [];
            const alreadyHasLogo = options.files.some(f => {
              const name = typeof f === 'object' && f.name ? f.name : (typeof f === 'string' ? f : '');
              return name.endsWith('logo.png');
            });
            if (!alreadyHasLogo) {
              options.files.push(new AttachmentBuilder('src/assets/logo.png', { name: 'logo.png' }));
            }
          }
        }
      }
      return origSend.call(this, options);
    };
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
  ],
});

setClient(client);

client.config = config;
client.guildConfigs = new Map();

const commandHandler = new CommandHandler(client);
const eventHandler = new EventHandler(client);
client.eventHandler = eventHandler;

async function loadCommands() {
  const { readdirSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));

  const commandDirs = ['moderation', 'utility', 'backup', 'antinuke', 'welcome', 'ticket', 'giveaway'];
  const basePath = join(__dirname, 'commands');

  for (const dir of commandDirs) {
    const dirPath = join(basePath, dir);
    let files;
    try {
      files = readdirSync(dirPath).filter(f => f.endsWith('.js')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const command = await import(`file://${join(dirPath, file)}`);
        if (command.data && command.execute) {
          await commandHandler.registerCommand(command);
          logger.debug(`Loaded command: ${command.data.name}`);
        }
      } catch (err) {
        logger.error(`Failed to load command ${file}: ${err.message}`);
      }
    }
  }

  logger.info(`Loaded ${client.commands.size} commands`);
}

async function loadEvents() {
  const { readdirSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));

  const eventsPath = join(__dirname, 'events');
  let files;
  try {
    files = readdirSync(eventsPath).filter(f => f.endsWith('.js')).sort();
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const event = await import(`file://${join(eventsPath, file)}`);
      await eventHandler.registerEvent(event);
      logger.debug(`Loaded event: ${event.name || file}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}: ${err.message}`);
    }
  }

  logger.info(`Loaded events`);
}

async function cacheAllGuildConfigs() {
  const guilds = client.guilds.cache;
  for (const [, guild] of guilds) {
    await eventHandler.cacheGuildConfig(guild.id);
  }
  logger.info(`Cached configs for ${guilds.size} guilds`);
}

async function processExpiredTempbans() {
  if (mongoose.connection.readyState !== 1) return;
  const { CaseModel } = await import('./models/Case.js');
  const now = new Date();
  const expired = await CaseModel.find({
    type: 'tempban',
    active: true,
    expiresAt: { $lte: now },
  });

  for (const entry of expired) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;

    try {
      await guild.bans.remove(entry.targetId, 'Tempban expired');
      entry.active = false;
      await entry.save();
      logger.info(`Auto-unbanned ${entry.targetId} in ${entry.guildId} (expired tempban)`);
    } catch (err) {
      if (err.code !== 5000) {
        logger.error(`Failed to process expired tempban ${entry.targetId}: ${err.message}`);
      }
    }
  }

  if (expired.length > 0) {
    logger.info(`Processed ${expired.length} expired tempbans`);
  }
}

async function processExpiredLocks() {
  if (mongoose.connection.readyState !== 1) return;
  const { CaseModel } = await import('./models/Case.js');
  const now = new Date();
  const expired = await CaseModel.find({
    type: 'lock',
    active: true,
    expiresAt: { $lte: now },
  });

  for (const entry of expired) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;

    const channel = guild.channels.cache.get(entry.targetId);
    if (!channel?.isTextBased()) {
      entry.active = false;
      await entry.save();
      continue;
    }

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      entry.active = false;
      await entry.save();
      logger.info(`Auto-unlocked #${channel.name} in ${entry.guildId} (expired lock)`);
    } catch (err) {
      logger.error(`Failed to process expired lock ${entry.targetId}: ${err.message}`);
    }
  }

  if (expired.length > 0) {
    logger.info(`Processed ${expired.length} expired locks`);
  }
}

function scheduleJobs() {
  nodeCron.schedule('*/30 * * * *', async () => {
    logger.debug('Running scheduled config cache refresh');
    for (const [, guild] of client.guilds.cache) {
      eventHandler.invalidateGuildConfig(guild.id);
      await eventHandler.cacheGuildConfig(guild.id);
    }
  });

  nodeCron.schedule('*/5 * * * *', async () => {
    await processExpiredTempbans();
    await processExpiredLocks();
    const { runQuarantineRelease } = await import('./events/guildMemberAdd.js');
    await runQuarantineRelease(client).catch(() => {});
  });

  nodeCron.schedule('0 */6 * * *', async () => {
    logger.debug('Running 6-hourly scheduled auto-backup check');
    const { createBackup } = await import('./utils/backup.js');
    const allGuilds = await GuildModel.find({ 'backupAuto.enabled': true }).lean();
    for (const g of allGuilds) {
      const guild = client.guilds.cache.get(g.guildId);
      if (!guild) continue;
      try {
        await createBackup(guild, client.user.id, 'Auto-Backup', true, 'Scheduled auto-backup');
      } catch (err) {
        logger.error(`Auto-backup failed for ${g.guildId}: ${err.message}`);
      }
    }
  });

  nodeCron.schedule('0 0 * * *', async () => {
    logger.debug('Running daily scheduled warning decay check');
    const { runWarningDecay } = await import('./utils/securityUtils.js');
    await runWarningDecay(client).catch(() => {});
  });
}

client.on('interactionCreate', async (interaction) => {
  // Helper to inject the logo file if any embed uses attachment://logo.png
  const injectLogoIfUsed = (options) => {
    if (options && typeof options === 'object' && options.embeds && Array.isArray(options.embeds)) {
      const usesLogo = options.embeds.some(emb => {
        const json = typeof emb.toJSON === 'function' ? emb.toJSON() : emb;
        return (json.footer?.icon_url?.startsWith('attachment://')) ||
               (json.thumbnail?.url?.startsWith('attachment://')) ||
               (json.author?.icon_url?.startsWith('attachment://'));
      });
      if (usesLogo) {
        options.files = options.files || [];
        const alreadyHasLogo = options.files.some(f => {
          const name = typeof f === 'object' && f.name ? f.name : (typeof f === 'string' ? f : '');
          return name.endsWith('logo.png');
        });
        if (!alreadyHasLogo) {
          options.files.push(new AttachmentBuilder('src/assets/logo.png', { name: 'logo.png' }));
        }
      }
    }
  };

  // Wrap interaction methods to automatically translate deprecated 'ephemeral' option to 'flags' and inject logo if used
  if (interaction.reply) {
    const origReply = interaction.reply.bind(interaction);
    interaction.reply = async (options) => {
      if (options && typeof options === 'object') {
        if ('ephemeral' in options) {
          if (options.ephemeral) {
            options.flags = (options.flags || 0) | MessageFlags.Ephemeral;
          }
          delete options.ephemeral;
        }
        injectLogoIfUsed(options);
      }
      return origReply(options);
    };
  }
  if (interaction.deferReply) {
    const origDeferReply = interaction.deferReply.bind(interaction);
    interaction.deferReply = async (options) => {
      if (options && typeof options === 'object') {
        if ('ephemeral' in options) {
          if (options.ephemeral) {
            options.flags = (options.flags || 0) | MessageFlags.Ephemeral;
          }
          delete options.ephemeral;
        }
      }
      return origDeferReply(options);
    };
  }
  if (interaction.followUp) {
    const origFollowUp = interaction.followUp.bind(interaction);
    interaction.followUp = async (options) => {
      if (options && typeof options === 'object') {
        if ('ephemeral' in options) {
          if (options.ephemeral) {
            options.flags = (options.flags || 0) | MessageFlags.Ephemeral;
          }
          delete options.ephemeral;
        }
        injectLogoIfUsed(options);
      }
      return origFollowUp(options);
    };
  }
  if (interaction.editReply) {
    const origEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = async (options) => {
      if (options && typeof options === 'object') {
        injectLogoIfUsed(options);
      }
      return origEditReply(options);
    };
  }
  if (interaction.update) {
    const origUpdate = interaction.update.bind(interaction);
    interaction.update = async (options) => {
      if (options && typeof options === 'object') {
        injectLogoIfUsed(options);
      }
      return origUpdate(options);
    };
  }

  if (interaction.isChatInputCommand()) {
    commandHandler.handleInteraction(interaction);
    return;
  }

  if (interaction.isAutocomplete()) {
    const commandName = interaction.commandName;
    const command = client.commands.get(commandName);
    if (command && typeof command.autocomplete === 'function') {
      try {
        await command.autocomplete(interaction, client);
      } catch (err) {
        logger.error(`Autocomplete error for command ${commandName}: ${err.message}`);
      }
    }
    return;
  }

  if (interaction.isButton() || interaction.isModalSubmit()) {
    await handleGiveawayInteraction(interaction, client).catch(err => logger.error(`Giveaway handler error: ${err.message}`));
  }

  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('appeal_')) {
    const { handleAppealInteraction } = await import('./handlers/appealHandler.js');
    await handleAppealInteraction(interaction, client).catch(err => logger.error(`Appeal interaction error: ${err.message}`));
    return;
  }

  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
    const { handleTicketInteraction } = await import('./handlers/ticketHandler.js');
    handleTicketInteraction(interaction, client).catch(err => logger.error(`Ticket handler error: ${err.message}`));
  }
});

client.on('guildCreate', async (guild) => {
  await eventHandler.cacheGuildConfig(guild.id);
  logger.info(`Joined guild: ${guild.name} (${guild.id})`);
});

client.on('guildDelete', async (guild) => {
  eventHandler.invalidateGuildConfig(guild.id);
  logger.info(`Left guild: ${guild.name} (${guild.id})`);
});

async function start() {
  try {
    logger.info(`Starting ${config.brandingName}...`);

    await connectMongo(config.mongoUri);

    await loadCommands();
    await loadEvents();

    client.once('clientReady', async () => {
      logger.info(`Logged in as ${client.user.tag}`);

      await commandHandler.deployCommands();
      await cacheAllGuildConfigs();
      giveawayManager.init(client);
      await processExpiredTempbans();
      await processExpiredLocks();
      scheduleJobs();

      const { runStartupHealthCheck } = await import('./handlers/antiNukeHandler.js');
      runStartupHealthCheck(client).catch(() => {});

      logger.info(`${config.brandingName} ready — ${client.guilds.cache.size} guilds`);

      let alertChannel = null;
      if (config.alertChannelId) {
        try {
          alertChannel = await client.channels.fetch(config.alertChannelId).catch(() => null);
        } catch { }
      }

      if (alertChannel) {
        const startupEmbed = new EmbedBuilder()
          .setColor(0x00FF7F)
          .setTitle('Bot Started')
          .setDescription(`${config.brandingName} is now online`)
          .addFields(
            { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Commands', value: `${client.commands.size}`, inline: true },
          )
          .setTimestamp();
        await alertChannel.send({ embeds: [startupEmbed] }).catch(err => logger.error(`Failed to send startup alert embed: ${err.message}`));
      }

      const { Transport } = await import('winston');
      const recentErrorMessages = new Set();

      class DiscordErrorTransport extends Transport {
        constructor(opts) {
          super(opts);
          this.client = opts.client;
          this.channelId = opts.channelId;
        }

        async log(info, callback) {
          setImmediate(() => this.emit('logged', info));
          if (info.level === 'error' && this.client?.isReady()) {
            const msgKey = info.message || '';
            if (recentErrorMessages.has(msgKey)) { callback(); return; }
            recentErrorMessages.add(msgKey);
            setTimeout(() => recentErrorMessages.delete(msgKey), 10000);

            const ch = this.client.channels.cache.get(this.channelId);
            if (ch) {
              try {
                const desc = (info.message || '').slice(0, 1900);
                const embed = new EmbedBuilder()
                  .setColor(0xFF0000)
                  .setTitle('Error')
                  .setDescription(`\`\`\`${desc}\`\`\``)
                  .setTimestamp();
                if (info.stack) {
                  embed.addFields({ name: 'Stack', value: `\`\`\`${info.stack.slice(0, 1000)}\`\`\`` });
                }
                await ch.send({ embeds: [embed] });
              } catch { }
            }
          }
          callback();
        }
      }

      if (config.alertChannelId) {
        logger.add(new DiscordErrorTransport({ client, channelId: config.alertChannelId }));
        logger.info('Discord error forwarding enabled');
      }
    });

    const port = process.env.PORT || 3000;
    http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Bot is online!');
    }).listen(port, () => {
      logger.info(`HTTP health check server listening on port ${port}`);
    });

    await client.login(config.token);
  } catch (err) {
    logger.error(`Failed to start: ${err.message}`, err);
    process.exit(1);
  }
}

start();

async function sendErrorToDiscord(title, message, stack) {
  if (!client.isReady?.() || !config.alertChannelId) return;
  try {
    const channel = await client.channels.fetch(config.alertChannelId).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle(title)
      .setDescription(`\`\`\`${(message || '').slice(0, 1900)}\`\`\``)
      .setTimestamp();
    if (stack) {
      embed.addFields({ name: 'Stack', value: `\`\`\`${stack.slice(0, 1000)}\`\`\`` });
    }
    await channel.send({ embeds: [embed] });
  } catch { }
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  client.removeAllListeners();
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch { }
  try {
    client.destroy();
    logger.info('Discord client destroyed');
  } catch { }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err.message}`, err);
  sendErrorToDiscord('Unhandled Rejection', err.message, err.stack);
});

process.on('uncaughtException', async (err) => {
  logger.error(`Uncaught exception: ${err.message}`, err);
  await sendErrorToDiscord('Uncaught Exception', err.message, err.stack);
  try {
    await mongoose.disconnect();
  } catch { }
  process.exit(1);
});
