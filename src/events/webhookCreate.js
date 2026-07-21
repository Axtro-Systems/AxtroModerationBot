import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent } from '../handlers/antiNukeHandler.js';

export const name = 'webhookCreate';

export async function execute(webhook, client) {
  if (!webhook.guild) return;

  const config = client.guildConfigs?.get(webhook.guild.id);
  const auditLogs = await webhook.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  if (executor) {
    await trackActionFromEvent(webhook.guild, executor.id, 'webhookCreate');
  }

  if (config?.auditChannel) {
    const logChannel = webhook.guild.channels.cache.get(config.auditChannel);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x00FF7F)
        .setTitle('Webhook Created')
        .addFields(
          { name: 'Name', value: webhook.name || 'Unknown', inline: true },
          { name: 'Channel', value: webhook.channel ? `${webhook.channel}` : 'Unknown', inline: true },
          { name: 'Created by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
        )
        .setTimestamp();

      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}
