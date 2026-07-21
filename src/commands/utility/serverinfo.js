import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';

export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('serverinfo')
  .setDescription('Get information about this server');

export async function execute(interaction, client) {

  const { guild } = interaction;
  await guild.fetch();

  const owner = await guild.fetchOwner().catch(() => null);

  const members = guild.members.cache;
  const humans = members.filter(m => !m.user.bot).size;
  const bots = members.filter(m => m.user.bot).size;

  const channels = guild.channels.cache;
  const textChannels = channels.filter(c => c.type === 0).size;
  const voiceChannels = channels.filter(c => c.type === 2).size;
  const categoryChannels = channels.filter(c => c.type === 4).size;

  const verificationMap = {
    0: 'None',
    1: 'Low',
    2: 'Medium',
    3: 'High',
    4: 'Very High',
  };

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) })
    .setThumbnail(guild.iconURL({ size: 4096 }))
    .addFields(
      { name: 'Name', value: guild.name, inline: true },
      { name: 'ID', value: guild.id, inline: true },
      { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
      { name: 'Created', value: time(guild.createdAt, TimestampStyles.LongDate), inline: true },
      { name: 'Members', value: `${members.size} (${humans} humans, ${bots} bots)`, inline: true },
      { name: 'Channels', value: `📝 ${textChannels} Text | 🔊 ${voiceChannels} Voice | 📁 ${categoryChannels} Category`, inline: true },
      { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
      { name: 'Boost Level', value: String(guild.premiumTier), inline: true },
      { name: 'Boost Count', value: String(guild.premiumSubscriptionCount || 0), inline: true },
      { name: 'Verification', value: verificationMap[guild.verificationLevel] || 'Unknown', inline: true },
      { name: '2FA Requirement', value: guild.mfaLevel === 0 ? 'Not Required' : 'Required', inline: true },
    );

  if (guild.vanityURLCode) {
    embed.addFields({ name: 'Vanity URL', value: `discord.gg/${guild.vanityURLCode}`, inline: true });
  }

  if (guild.description) {
    embed.addFields({ name: 'Description', value: guild.description, inline: false });
  }

  embed.setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
