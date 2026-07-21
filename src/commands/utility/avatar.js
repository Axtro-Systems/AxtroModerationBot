import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';

export const defer = false;

export const data = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('Get a user\'s avatar')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user whose avatar to show')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('format')
      .setDescription('The image format')
      .setRequired(false)
      .addChoices(
        { name: 'PNG', value: 'png' },
        { name: 'JPG', value: 'jpg' },
        { name: 'WebP', value: 'webp' },
        { name: 'GIF', value: 'gif' },
      ));

export async function execute(interaction, client) {
  const user = interaction.options.getUser('user') || interaction.user;
  const format = interaction.options.getString('format') || 'png';

  const formats = ['png', 'jpg', 'webp', 'gif'];
  const links = formats.map(f =>
    `[${f.toUpperCase()}](${user.displayAvatarURL({ extension: f, size: 4096, forceStatic: f !== 'gif' })})`
  ).join(' | ');

  const avatarUrl = user.displayAvatarURL({ extension: format, size: 4096, forceStatic: format !== 'gif' });

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ size: 256 }) })
    .setTitle('Avatar')
    .setURL(avatarUrl)
    .setImage(avatarUrl)
    .addFields(
      { name: 'Links', value: links, inline: false },
    )
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
