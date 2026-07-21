import { EmbedBuilder } from 'discord.js';

export const name = 'messageDelete';

export async function execute(message, client) {
  if (!message.guild) return;
  if (message.author?.bot) return;

  const config = client.guildConfigs?.get(message.guild.id);
  if (!config?.auditChannel) return;

  const channel = message.guild.channels.cache.get(config.auditChannel);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle('Message Deleted')
    .addFields(
      { name: 'Author', value: `${message.author?.tag || 'Unknown'} (${message.author?.id || 'Unknown'})`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Content', value: '(Content not logged for privacy)' },
    )
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(() => {});
}
