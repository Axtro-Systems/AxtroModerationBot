import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent, triggerOnDemandBackup } from '../handlers/antiNukeHandler.js';

export const name = 'roleCreate';

export async function execute(role, client) {
  if (!role.guild) return;

  const config = client.guildConfigs?.get(role.guild.id);
  const auditLogs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  if (executor) {
    await trackActionFromEvent(role.guild, executor.id, 'roleCreate');
  }

  if (config?.auditChannel) {
    const logChannel = role.guild.channels.cache.get(config.auditChannel);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(0x00FF7F)
      .setTitle('Role Created')
      .addFields(
        { name: 'Role', value: `${role.name} (${role.id})`, inline: true },
        { name: 'Color', value: role.hexColor, inline: true },
        { name: 'Created by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  triggerOnDemandBackup(role.guild);
}
