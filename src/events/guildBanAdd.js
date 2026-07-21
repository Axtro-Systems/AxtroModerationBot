import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent } from '../handlers/antiNukeHandler.js';

export const name = 'guildBanAdd';

export async function execute(ban, client) {
  if (!ban.guild) return;

  let config = client.guildConfigs?.get(ban.guild.id);
  if (!config) {
    const { GuildModel } = await import('../models/Guild.js');
    config = await GuildModel.findOne({ guildId: ban.guild.id }).lean().catch(() => null);
  }

  const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  if (executor) {
    await trackActionFromEvent(ban.guild, executor.id, 'ban');
  }

  const logChannelId = config?.modLogChannel || config?.auditChannel;
  if (logChannelId) {
    const logChannel = ban.guild.channels.cache.get(logChannelId);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Member Banned')
        .addFields(
          { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
          { name: 'Banned by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
          { name: 'Reason', value: ban.reason || 'No reason provided', inline: false },
        )
        .setTimestamp();

      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}
