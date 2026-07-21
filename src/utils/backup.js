import { BackupModel } from '../models/Backup.js';
import { GuildModel } from '../models/Guild.js';
import { logger } from './logger.js';
import crypto from 'crypto';

function omitUndefined(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, omitUndefined(val)])
    );
  }
  return value;
}

async function pruneOldBackups(guildId) {
  const guildConfig = await GuildModel.findOne({ guildId }).lean();
  const keep = guildConfig?.backupAuto?.keep || 10;
  const excess = await BackupModel.find({ guildId })
    .sort({ createdAt: -1 })
    .skip(keep)
    .select('backupId')
    .lean();

  if (excess.length === 0) return;

  await BackupModel.deleteMany({ backupId: { $in: excess.map(b => b.backupId) } });
  logger.info(`Pruned ${excess.length} old backup(s) for guild ${guildId}`);
}

export async function createBackup(guild, createdBy, name, autoTriggered = false, triggerReason = '') {
  const backupId = crypto.randomBytes(8).toString('hex');

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .map(r => ({
      id: r.id, name: r.name, color: r.color,
      hoist: r.hoist, mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
      icon: r.icon, unicodeEmoji: r.unicodeEmoji,
    }));

  const channels = guild.channels.cache
    .map(c => ({
      id: c.id, name: c.name, type: c.type,
      position: c.position, topic: c.topic,
      nsfw: c.nsfw, rateLimitPerUser: c.rateLimitPerUser,
      parentId: c.parentId,
      permissionOverwrites: c.permissionOverwrites?.cache?.map(o => ({
        id: o.id, type: o.type,
        allow: o.allow ? o.allow.bitfield.toString() : '0',
        deny: o.deny ? o.deny.bitfield.toString() : '0',
      })) || [],
      bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null,
      defaultAutoArchiveDuration: c.defaultAutoArchiveDuration ?? null,
    }));

  const emojis = guild.emojis.cache.map(e => ({
    name: e.name, url: e.imageURL(), animated: e.animated,
  }));

  const stickers = guild.stickers?.cache.map(s => ({
    name: s.name, url: s.url, description: s.description,
  })) || [];

  const bans = [];
  try {
    const banList = await guild.bans.fetch();
    bans.push(...banList.map(b => ({ userId: b.user.id, reason: b.reason || '' })));
  } catch { }

  const webhooks = [];
  try {
    const channelsWithWebhooks = guild.channels.cache.filter(c => c.isTextBased());
    for (const [, ch] of channelsWithWebhooks) {
      try {
        const hooks = await ch.fetchWebhooks();
        hooks.forEach(h => webhooks.push({ channelId: h.channelId, name: h.name, avatar: h.avatar }));
      } catch { }
    }
  } catch { }

  const snapshot = omitUndefined({
    name: guild.name,
    icon: guild.icon,
    banner: guild.banner,
    description: guild.description,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    afkTimeout: guild.afkTimeout,
    systemChannelFlags: guild.systemChannelFlags?.bitfield || 0,
    roles, channels, emojis, stickers, bans, webhooks,
  });

  const backup = new BackupModel({
    guildId: guild.id,
    backupId,
    name: name || `Backup-${new Date().toISOString().slice(0, 10)}`,
    createdBy,
    snapshot,
    autoTriggered,
    triggerReason,
  });

  await backup.save();
  await pruneOldBackups(guild.id);

  logger.info(`Backup ${backupId} created for guild ${guild.id} by ${createdBy}`);
  return backup;
}

export async function deleteBackup(backupId, guildId) {
  const result = await BackupModel.findOneAndDelete({ backupId, guildId });
  return result;
}

export async function listBackups(guildId, page = 0) {
  const total = await BackupModel.countDocuments({ guildId });
  const backups = await BackupModel.find({ guildId })
    .sort({ createdAt: -1 })
    .skip(page * 10)
    .limit(10)
    .lean();
  return { backups, total, totalPages: Math.ceil(total / 10) || 1 };
}

export async function getBackup(backupId) {
  return BackupModel.findOne({ backupId }).lean();
}

export async function scheduleAutoBackup(guildId, enabled, intervalHours, keep) {
  await GuildModel.findOneAndUpdate(
    { guildId },
    {
      'backupAuto.enabled': enabled,
      'backupAuto.interval': intervalHours,
      'backupAuto.keep': keep,
    },
    { upsert: true }
  );
}
