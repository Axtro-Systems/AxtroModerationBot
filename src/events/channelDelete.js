import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent, triggerOnDemandBackup } from '../handlers/antiNukeHandler.js';

export const name = 'channelDelete';

export async function execute(channel, client) {
  if (!channel.guild) return;

  const config = client.guildConfigs?.get(channel.guild.id);
  const auditLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  if (executor) {
    await trackActionFromEvent(channel.guild, executor.id, 'channelDelete');
  }

  if (config?.auditChannel) {
    const logChannel = channel.guild.channels.cache.get(config.auditChannel);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Channel Deleted')
        .addFields(
          { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
          { name: 'Type', value: String(channel.type), inline: true },
          { name: 'Deleted by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
        )
        .setTimestamp();

      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  triggerOnDemandBackup(channel.guild);
}
