import { AuditLogEvent } from 'discord.js';
import { handleAuditLogEvent } from '../handlers/antiNukeHandler.js';

export const name = 'guildAuditLogEntryCreate';

const trackedActions = new Set([
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberKick,
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.GuildUpdate,
  AuditLogEvent.EmojiCreate,
  AuditLogEvent.EmojiDelete,
  AuditLogEvent.StickerCreate,
  AuditLogEvent.StickerDelete,
  AuditLogEvent.BotAdd,
  AuditLogEvent.IntegrationCreate,
]);

export async function execute(entry, guild, client) {
  if (!entry || !entry.action) return;
  if (!trackedActions.has(entry.action)) return;
  if (!entry.executor?.id || entry.executor.id === client.user.id) return;

  let config = client.guildConfigs?.get(guild.id);
  if (!config) {
    config = await client.eventHandler?.cacheGuildConfig(guild.id);
  }
  if (!config?.antiNuke?.enabled) return;
  if (config.antiNuke.whitelist?.includes(entry.executor.id)) return;

  await handleAuditLogEvent(guild, entry.action, entry.executor.id, entry.id);
}
