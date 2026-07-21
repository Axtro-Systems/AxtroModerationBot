import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent, triggerOnDemandBackup } from '../handlers/antiNukeHandler.js';

export const name = 'roleDelete';

export async function execute(role, client) {
  if (!role.guild) return;

  const config = client.guildConfigs?.get(role.guild.id);
  const auditLogs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;

  if (executor) {
    await trackActionFromEvent(role.guild, executor.id, 'roleDelete');
  }

  if (config?.auditChannel) {
    const logChannel = role.guild.channels.cache.get(config.auditChannel);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Role Deleted')
        .addFields(
          { name: 'Role', value: `${role.name} (${role.id})`, inline: true },
          { name: 'Deleted by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: true },
        )
        .setTimestamp();

      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  triggerOnDemandBackup(role.guild);
}
