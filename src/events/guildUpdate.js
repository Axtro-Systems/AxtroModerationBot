import { EmbedBuilder, AuditLogEvent } from 'discord.js';
import { trackActionFromEvent } from '../handlers/antiNukeHandler.js';

export const name = 'guildUpdate';

export async function execute(oldGuild, newGuild, client) {
  const config = client.guildConfigs?.get(newGuild.id);
  const auditLogs = await newGuild.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  const executor = entry?.executor;
  if (!executor) return;

  await trackActionFromEvent(newGuild, executor.id, 'guildUpdate');

  if (config?.auditChannel) {
    const logChannel = newGuild.channels.cache.get(config.auditChannel);
    if (!logChannel) return;

    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`Name: **${oldGuild.name}** → **${newGuild.name}**`);
    if (oldGuild.icon !== newGuild.icon) changes.push('Icon changed');
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push(`Verification: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
    if (oldGuild.description !== newGuild.description) changes.push('Description changed');

    if (changes.length === 0) return;

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('Server Updated')
      .setDescription(changes.join('\n'))
      .addFields(
        { name: 'Updated by', value: `${executor.tag} (${executor.id})` },
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => {});
  }
}
