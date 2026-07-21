import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';

const CHANNEL_TYPES = {
  0: 'Text',
  1: 'DM',
  2: 'Voice',
  3: 'Group DM',
  4: 'Category',
  5: 'Announcement',
  10: 'Announcement Thread',
  11: 'Public Thread',
  12: 'Private Thread',
  13: 'Stage Voice',
  14: 'Directory',
  15: 'Forum',
  16: 'Media',
};

export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('channelinfo')
  .setDescription('Get information about a channel')
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('The channel to get info about')
      .setRequired(false));

export async function execute(interaction, client) {

  const channel = interaction.options.getChannel('channel') || interaction.channel;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(channel.name)
    .addFields(
      { name: 'Name', value: channel.name, inline: true },
      { name: 'ID', value: channel.id, inline: true },
      { name: 'Type', value: CHANNEL_TYPES[channel.type] || 'Unknown', inline: true },
    );

  if (channel.topic) {
    embed.addFields({ name: 'Topic', value: channel.topic, inline: false });
  }

  embed.addFields(
    { name: 'Position', value: String(channel.position), inline: true },
    { name: 'NSFW', value: channel.nsfw ? 'Yes' : 'No', inline: true },
  );

  if ('rateLimitPerUser' in channel) {
    embed.addFields({ name: 'Slowmode', value: channel.rateLimitPerUser > 0 ? `${channel.rateLimitPerUser}s` : 'Off', inline: true });
  }

  if (channel.parent) {
    embed.addFields({ name: 'Category', value: channel.parent.name, inline: true });
  }

  embed.addFields(
    { name: 'Created', value: time(channel.createdAt, TimestampStyles.LongDate), inline: true },
  );

  if ('permissionOverwrites' in channel) {
    const everyoneOverwrite = channel.permissionOverwrites.cache.get(interaction.guild.id);
    const everyoneAllowed = everyoneOverwrite?.allow?.toArray() || [];
    const everyoneDenied = everyoneOverwrite?.deny?.toArray() || [];
    const synced = !everyoneOverwrite;
    embed.addFields({ name: 'Permissions Synced', value: synced ? 'Yes' : 'No (custom overwrites)', inline: true });
  }

  embed.setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
