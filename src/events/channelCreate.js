import { EmbedBuilder, AuditLogEvent, ChannelType } from 'discord.js';
import { trackActionFromEvent, triggerOnDemandBackup } from '../handlers/antiNukeHandler.js';

export const name = 'channelCreate';

export async function execute(channel, client) {
  if (!channel.guild) return;

  const config = client.guildConfigs?.get(channel.guild.id);
  const auditLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor || 'Unknown';

  if (entry?.executor) {
    await trackActionFromEvent(channel.guild, entry.executor.id, 'channelCreate');
  }

  if (config?.auditChannel) {
    const logChannel = channel.guild.channels.cache.get(config.auditChannel);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(0x00FF7F)
      .setTitle('Channel Created')
      .addFields(
        { name: 'Channel', value: `${channel} (${channel.name})`, inline: true },
        { name: 'Type', value: ChannelType[channel.type] || String(channel.type), inline: true },
        { name: 'Created by', value: `${executor.tag || executor} (${executor.id || 'Unknown'})`, inline: true },
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  triggerOnDemandBackup(channel.guild);
}
