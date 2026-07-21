import { EmbedBuilder, AuditLogEvent } from 'discord.js';

export const name = 'guildBanRemove';

export async function execute(ban, client) {
  if (!ban.guild) return;

  let config = client.guildConfigs?.get(ban.guild.id);
  if (!config) {
    const { GuildModel } = await import('../models/Guild.js');
    config = await GuildModel.findOne({ guildId: ban.guild.id }).lean().catch(() => null);
  }

  const logChannelId = config?.modLogChannel || config?.auditChannel;
  if (!logChannelId) return;

  const logChannel = ban.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;

  const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  const embed = new EmbedBuilder()
    .setColor(0x00FF7F)
    .setTitle('Member Unbanned')
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      { name: 'Unbanned by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
    )
    .setTimestamp();

  logChannel.send({ embeds: [embed] }).catch(() => {});
}
