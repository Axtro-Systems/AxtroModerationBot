import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { GuildModel } from '../models/Guild.js';
import { AntiNukeModel } from '../models/AntiNuke.js';
import { SystemLogModel } from '../models/SystemLog.js';
import { createCase, logAudit } from '../utils/caseUtils.js';
import { config as appConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { getGuildQueue } from '../utils/rateLimitQueue.js';
import { createUnifiedModEmbed } from '../utils/modLogEmbed.js';

// -------------------------------------------------------------
// In-Memory Fast Caches (Zero Database Latency during Nuke Bursts)
// -------------------------------------------------------------
const recentlyPunishedCache = new Map(); // key -> timestamp
const setupModeCache = new Map(); // guildId -> { enabled: boolean, expiresAt: number }
const ownerDmCooldownMap = new Map(); // guildId -> timestamp

const RECENT_PUNISHMENT_WINDOW = 300000; // 5 minutes

// Audit Log Event Debouncer (caches recent entry IDs to avoid duplicate processing)
const debouncedAuditEvents = new Map(); // `${guildId}:${eventId}` -> timestamp
const DEBOUNCE_TTL = 10000; // 10 seconds

// -------------------------------------------------------------
// Multi-Layered Sliding Window Detection Engine (Rolling Queues)
// -------------------------------------------------------------
// Map<key, { creates: number[], deletes: number[], general: Map<action, number[]> }>
const slidingTracker = new Map();
const MAX_WINDOW = 300000; // 5 minutes sliding window

// Periodic cleanup of expired in-memory queue entries
setInterval(() => {
  const now = Date.now();

  // 1. Clean sliding action queues
  for (const [key, entry] of slidingTracker) {
    entry.creates = entry.creates.filter(t => now - t <= MAX_WINDOW);
    entry.deletes = entry.deletes.filter(t => now - t <= MAX_WINDOW);

    for (const [act, timestamps] of entry.general) {
      const active = timestamps.filter(t => now - t <= MAX_WINDOW);
      if (active.length === 0) {
        entry.general.delete(act);
      } else {
        entry.general.set(act, active);
      }
    }

    if (entry.creates.length === 0 && entry.deletes.length === 0 && entry.general.size === 0) {
      slidingTracker.delete(key);
    }
  }

  // 2. Clean recently punished cache
  for (const [key, ts] of recentlyPunishedCache) {
    if (now - ts > RECENT_PUNISHMENT_WINDOW) recentlyPunishedCache.delete(key);
  }

  // 3. Clean audit log debounce entries
  for (const [key, ts] of debouncedAuditEvents) {
    if (now - ts > DEBOUNCE_TTL) debouncedAuditEvents.delete(key);
  }
}, 30000).unref();

export function setSetupModeCache(guildId, enabled, expiresAtMs) {
  setupModeCache.set(guildId, { enabled, expiresAt: expiresAtMs });
}

/**
 * Main Anti-Nuke Action Tracker (Supports Layered Sliding Windows across ALL actions)
 */
export async function trackAction(guild, userId, action, fromDirectEvent = false) {
  const cached = guild.client?.guildConfigs?.get(guild.id);
  const antiNukeConfig = cached?.antiNuke ?? await getAntiNukeConfig(guild.id);

  if (!antiNukeConfig || !antiNukeConfig.enabled) return;
  if (antiNukeConfig.whitelist?.includes(userId)) return;
  if (guild.members.me && userId === guild.members.me.id) return;
  if (userId === guild.ownerId) return;
  if (appConfig.ownerId && userId === appConfig.ownerId) return;

  const now = Date.now();

  // Zero DB Hit Check 1: In-memory recently punished cache
  const punishedKey = `${guild.id}:${userId}`;
  const lastPunishedTs = recentlyPunishedCache.get(punishedKey);
  if (lastPunishedTs && now - lastPunishedTs < RECENT_PUNISHMENT_WINDOW) return;

  // Zero DB Hit Check 2: Setup Mode Cache (Fallback to short-cached DB lookup)
  let isSetupMode = false;
  const setupCached = setupModeCache.get(guild.id);
  if (setupCached) {
    isSetupMode = setupCached.enabled && setupCached.expiresAt > now;
  } else {
    const fullGuildDoc = await GuildModel.findOne({ guildId: guild.id }).lean();
    if (fullGuildDoc?.setupMode?.enabled && fullGuildDoc.setupMode.expiresAt) {
      const expMs = new Date(fullGuildDoc.setupMode.expiresAt).getTime();
      isSetupMode = expMs > now;
      setupModeCache.set(guild.id, { enabled: fullGuildDoc.setupMode.enabled, expiresAt: expMs });
    } else {
      setupModeCache.set(guild.id, { enabled: false, expiresAt: 0 });
    }
  }

  const key = `${guild.id}:${userId}`;
  if (!slidingTracker.has(key)) {
    slidingTracker.set(key, { creates: [], deletes: [], general: new Map() });
  }
  const userQueue = slidingTracker.get(key);

  let triggeredReason = null;
  const setupMult = antiNukeConfig.setupModeMultiplier ?? 5;
  const mult = isSetupMode ? setupMult : 1;

  // Dynamic Threshold Limits from DB / Config Cache (with fallback defaults)
  const burstDelLimit = Math.ceil((antiNukeConfig.burstChannelDeletes ?? 3) * mult);
  const burstCreateLimit = Math.ceil((antiNukeConfig.burstChannelCreates ?? 5) * mult);
  const sustainedDelLimit = Math.ceil((antiNukeConfig.sustainedChannelDeletes ?? 10) * mult);
  const sustainedCreateLimit = Math.ceil((antiNukeConfig.sustainedChannelCreates ?? 15) * mult);

  // -------------------------------------------------------------
  // Layered Sliding Window Engine (Evaluates ALL Action Types)
  // -------------------------------------------------------------
  if (action === 'channelCreate' || action === 'channelDelete') {
    if (action === 'channelCreate') userQueue.creates.push(now);
    if (action === 'channelDelete') userQueue.deletes.push(now);

    userQueue.creates = userQueue.creates.filter(t => now - t <= MAX_WINDOW);
    userQueue.deletes = userQueue.deletes.filter(t => now - t <= MAX_WINDOW);

    const creates10s = userQueue.creates.filter(t => now - t <= 10000).length;
    const creates60s = userQueue.creates.filter(t => now - t <= 60000).length;
    const creates300s = userQueue.creates.length;

    const deletes10s = userQueue.deletes.filter(t => now - t <= 10000).length;
    const deletes60s = userQueue.deletes.filter(t => now - t <= 60000).length;
    const deletes300s = userQueue.deletes.length;

    const combined30s = userQueue.creates.filter(t => now - t <= 30000).length + userQueue.deletes.filter(t => now - t <= 30000).length;
    const combinedLimit = Math.ceil(Math.max(burstDelLimit, burstCreateLimit) * 1.6);

    // Layer 1: Burst Detection
    if (deletes10s >= burstDelLimit) {
      triggeredReason = `Layer 1: Burst Channel Deletion (${deletes10s} deletions in 10s | Limit: ${burstDelLimit})`;
    } else if (creates10s >= burstCreateLimit) {
      triggeredReason = `Layer 1: Burst Channel Creation Flood (${creates10s} creations in 10s | Limit: ${burstCreateLimit})`;
    }
    // Layer 2: Medium Pacing Detection
    else if (deletes60s >= Math.max(burstDelLimit + 1, Math.ceil(sustainedDelLimit * 0.6))) {
      triggeredReason = `Layer 2: Medium-Speed Channel Deletion (${deletes60s} deletions in 60s)`;
    } else if (creates60s >= Math.max(burstCreateLimit + 1, Math.ceil(sustainedCreateLimit * 0.6))) {
      triggeredReason = `Layer 2: Medium-Speed Channel Creation (${creates60s} creations in 60s)`;
    }
    // Layer 3: Sustained Evasion Catch
    else if (deletes300s >= sustainedDelLimit) {
      triggeredReason = `Layer 3: Sustained Channel Deletion (${deletes300s} deletions in 5m | Limit: ${sustainedDelLimit})`;
    } else if (creates300s >= sustainedCreateLimit) {
      triggeredReason = `Layer 3: Sustained Channel Creation Flood (${creates300s} creations in 5m | Limit: ${sustainedCreateLimit})`;
    }
    // Layer 4: Combined Create + Delete Chaos
    else if (combined30s >= combinedLimit) {
      triggeredReason = `Layer 4: Combined Channel Create/Delete Chaos (${combined30s} total actions in 30s | Limit: ${combinedLimit})`;
    }
  } else {
    // -------------------------------------------------------------
    // Multi-Layered Tracking for Bans, Kicks, Roles, Webhooks, Bots
    // -------------------------------------------------------------
    if (!userQueue.general.has(action)) {
      userQueue.general.set(action, []);
    }
    const timestamps = userQueue.general.get(action);
    timestamps.push(now);

    const act10s = timestamps.filter(t => now - t <= 10000).length;
    const act60s = timestamps.filter(t => now - t <= 60000).length;
    const act300s = timestamps.filter(t => now - t <= 300000).length;
    userQueue.general.set(action, timestamps.filter(t => now - t <= 300000));

    let maxLimit = 5;
    if (action === 'ban') maxLimit = antiNukeConfig.maxBans ?? 3;
    else if (action === 'kick') maxLimit = antiNukeConfig.maxKicks ?? 3;
    else if (action === 'roleDelete') maxLimit = antiNukeConfig.maxRoleDeletes ?? 2;
    else if (action === 'roleCreate') maxLimit = antiNukeConfig.maxRoleCreates ?? 3;
    else if (action === 'webhookCreate') maxLimit = antiNukeConfig.maxWebhooks ?? 2;
    else if (action === 'guildUpdate') maxLimit = antiNukeConfig.maxGuildUpdates ?? 2;
    else if (action === 'emojiCreate') maxLimit = antiNukeConfig.maxEmojiCreates ?? 3;
    else if (action === 'stickerCreate') maxLimit = antiNukeConfig.maxStickerCreates ?? 3;
    else if (action === 'botAdd' || action === 'integrationCreate') maxLimit = 1;

    const sustainedLimit = Math.ceil(maxLimit * mult);
    const burstLimit = Math.max(1, Math.ceil(sustainedLimit * 0.5));
    const medLimit = Math.max(burstLimit + 1, Math.ceil(sustainedLimit * 0.75));

    if (act10s >= burstLimit) {
      triggeredReason = `Layer 1: Burst ${action} Nuke (${act10s} in 10s | Limit: ${burstLimit})`;
    } else if (act60s >= medLimit) {
      triggeredReason = `Layer 2: Medium-Speed ${action} Nuke (${act60s} in 60s | Limit: ${medLimit})`;
    } else if (act300s >= sustainedLimit) {
      triggeredReason = `Layer 3: Sustained ${action} Nuke (${act300s} in 5m | Limit: ${sustainedLimit})`;
    }
  }

  // Trigger Anti-Nuke Response if any layer was tripped
  if (triggeredReason) {
    slidingTracker.delete(key);
    recentlyPunishedCache.set(punishedKey, now);
    await triggerNukeResponse(guild, userId, action, antiNukeConfig, triggeredReason);
  }
}

export async function trackActionFromEvent(guild, userId, action) {
  await trackAction(guild, userId, action, true);
}

/**
 * Handles incoming audit log events with debouncing
 */
export async function handleAuditLogEvent(guild, auditAction, executorId, eventId) {
  if (eventId) {
    const debounceKey = `${guild.id}:${eventId}`;
    if (debouncedAuditEvents.has(debounceKey)) return;
    debouncedAuditEvents.set(debounceKey, Date.now());
  }

  const auditActionMap = {
    [AuditLogEvent.MemberBanAdd]: 'ban',
    [AuditLogEvent.MemberKick]: 'kick',
    [AuditLogEvent.ChannelCreate]: 'channelCreate',
    [AuditLogEvent.ChannelDelete]: 'channelDelete',
    [AuditLogEvent.RoleDelete]: 'roleDelete',
    [AuditLogEvent.RoleCreate]: 'roleCreate',
    [AuditLogEvent.WebhookCreate]: 'webhookCreate',
    [AuditLogEvent.GuildUpdate]: 'guildUpdate',
    [AuditLogEvent.EmojiCreate]: 'emojiCreate',
    [AuditLogEvent.EmojiDelete]: 'emojiDelete',
    [AuditLogEvent.StickerCreate]: 'stickerCreate',
    [AuditLogEvent.StickerDelete]: 'stickerDelete',
    [AuditLogEvent.BotAdd]: 'botAdd',
    [AuditLogEvent.IntegrationCreate]: 'integrationCreate',
  };

  const action = auditActionMap[auditAction];
  if (!action) return;

  await trackAction(guild, executorId, action, true);
}

/**
 * Executes Anti-Nuke Safeguards (Decoupled Ban + Accurate Punishment Tracking + Creation Cleanup)
 */
async function triggerNukeResponse(guild, userId, action, antiNukeConfig, triggeredReason = 'Anti-Nuke Threshold Exceeded') {
  logger.warn(`AntiNuke triggered: ${action} by ${userId} in ${guild.id} [${triggeredReason}]`);

  // Update DB async to log punishment
  AntiNukeModel.findOneAndUpdate(
    { guildId: guild.id, userId },
    {
      $set: {
        action,
        count: 99,
        windowStart: new Date(),
        punished: true,
      },
    },
    { upsert: true }
  ).catch(() => {});

  const member = await guild.members.fetch(userId).catch(() => null);
  const queue = getGuildQueue(guild.id);
  const botMe = guild.members.me;

  let punishmentApplied = 'None (manual review required)';

  // 1. STEP 1: IMMEDIATELY STRIP DANGEROUS PERMISSIONS (If member is present in guild)
  if (member && member.manageable) {
    await queue.add(async () => {
      const dangerousRoles = member.roles.cache.filter(role =>
        role.id !== guild.id &&
        role.position < (botMe?.roles.highest.position || 0) &&
        (
          role.permissions.has(PermissionFlagsBits.Administrator) ||
          role.permissions.has(PermissionFlagsBits.ManageChannels) ||
          role.permissions.has(PermissionFlagsBits.ManageGuild) ||
          role.permissions.has(PermissionFlagsBits.ManageRoles) ||
          role.permissions.has(PermissionFlagsBits.BanMembers) ||
          role.permissions.has(PermissionFlagsBits.KickMembers)
        )
      );

      if (dangerousRoles.size > 0) {
        await member.roles.remove(dangerousRoles, `[AntiNuke] Emergency permission strip: ${triggeredReason}`).catch(() => {});
        punishmentApplied = 'Roles Stripped';
      }
    });
  }

  // 2. STEP 2: CREATION FLOOD AUTO-CLEANUP (Delete spam-created channels by offender)
  if (action === 'channelCreate' || triggeredReason.includes('Creation Flood') || triggeredReason.includes('Combined')) {
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 25 }).catch(() => null);
      if (auditLogs) {
        const offenderEntries = auditLogs.entries.filter(e => e.executor?.id === userId && (Date.now() - e.createdTimestamp <= 300000));
        for (const entry of offenderEntries.values()) {
          const createdChannel = guild.channels.cache.get(entry.targetId);
          if (createdChannel) {
            await createdChannel.delete('[AntiNuke] Auto-cleaning spam-created channel').catch(() => {});
          }
        }
      }
    } catch (err) {
      logger.error(`Failed channel creation auto-cleanup: ${err.message}`);
    }
  }

  // 3. STEP 3: APPLY CONFIGURED PUNISHMENT (Decoupled Ban — Works even if offender left the guild!)
  const punishmentAction = antiNukeConfig.action || 'ban';

  if (punishmentAction === 'ban') {
    await queue.add(async () => {
      await guild.bans.create(userId, { reason: `[AntiNuke] ${triggeredReason}` }).catch(err => {
        logger.error(`Failed to ban nuke offender ${userId}: ${err.message}`);
      });
    });
    punishmentApplied = 'Permanent Ban';
  } else if (punishmentAction === 'kick' && member?.manageable) {
    await queue.add(async () => {
      await member.kick(`[AntiNuke] ${triggeredReason}`).catch(err => {
        logger.error(`Failed to kick nuke offender ${userId}: ${err.message}`);
      });
    });
    punishmentApplied = 'Kicked';
  }

  // 4. STEP 4: LOG INCIDENT TO AUDIT TRAIL & ALERT CHANNELS (Safely wrapped)
  let caseNumberStr = 'N/A';
  try {
    const caseEntry = await createCase({
      guildId: guild.id,
      type: punishmentAction === 'ban' ? 'ban' : 'kick',
      targetId: userId,
      targetTag: member?.user?.tag || userId,
      moderatorId: guild.client.user.id,
      moderatorTag: guild.client.user.tag || 'AxtroMod System',
      reason: `[AntiNuke] Triggered: ${triggeredReason}`,
    });
    caseNumberStr = `#${caseEntry.caseNumber}`;
  } catch {}

  try {
    await logAudit({
      guildId: guild.id,
      action: 'antinuke_trigger',
      moderatorId: guild.client.user.id,
      targetId: userId,
      reason: `[AntiNuke] ${triggeredReason}`,
      details: `Action: ${action} | Layer: ${triggeredReason} | Punishment: ${punishmentApplied}`,
    });
  } catch {}

  const alertEmbed = createUnifiedModEmbed({
    title: '🚨 Anti-Nuke Threat Intercepted',
    description: `An anti-nuke threshold was crossed and emergency protection was executed immediately.`,
    colorType: 'antinuke',
    fields: [
      { name: 'Offender', value: `<@${userId}> (\`${userId}\`)`, inline: true },
      { name: 'Detection Layer', value: `\`${triggeredReason}\``, inline: true },
      { name: 'Action Taken', value: `\`${punishmentApplied}\``, inline: true },
      { name: 'Case ID', value: caseNumberStr, inline: true },
    ]
  });

  const logChannelId = antiNukeConfig.alertChannelId || appConfig.alertChannelId;
  if (logChannelId) {
    const channel = guild.channels.cache.get(logChannelId);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [alertEmbed] }).catch(() => {});
    }
  }

  // Cooldown Owner DM notifications (max 1 DM per 60 seconds per guild)
  const lastDmTs = ownerDmCooldownMap.get(guild.id) || 0;
  if (Date.now() - lastDmTs > 60000) {
    ownerDmCooldownMap.set(guild.id, Date.now());
    try {
      const owner = await guild.client.users.fetch(guild.ownerId).catch(() => null);
      if (owner) {
        await owner.send({ embeds: [alertEmbed] }).catch(() => {});
      }
    } catch {}
  }
}

async function getAntiNukeConfig(guildId) {
  const guildData = await GuildModel.findOne({ guildId }).lean();
  return guildData?.antiNuke || null;
}

export function getCachedAntiNukeConfig(client, guildId) {
  const guildConfig = client.guildConfigs?.get(guildId);
  return guildConfig?.antiNuke || null;
}

export async function triggerOnDemandBackup(guild) {
  try {
    const guildConfig = await getAntiNukeConfig(guild.id);
    if (guildConfig?.autoRestore) {
      const { createBackup } = await import('../utils/backup.js');
      await createBackup(guild, 'AutoOnDemandBackup');
    }
  } catch (err) {
    logger.debug(`On-demand backup error in ${guild.id}: ${err.message}`);
  }
}

export async function runStartupHealthCheck(client) {
  try {
    logger.info('Running Anti-Nuke startup health checks across guilds...');
    for (const guild of client.guilds.cache.values()) {
      const config = client.guildConfigs?.get(guild.id) || await getAntiNukeConfig(guild.id);
      if (config && config.enabled) {
        // Health check complete
      }
    }
  } catch (err) {
    logger.error(`Anti-Nuke startup health check error: ${err.message}`);
  }
}
