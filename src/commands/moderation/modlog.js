import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';

export const data = new SlashCommandBuilder()
  .setName('modlog')
  .setDescription('Configure the moderation log channel')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Set the moderation log channel')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel for mod logs').setRequired(true))
  );

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Guild permission.')] });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const channel = interaction.options.getChannel('channel', true);

    if (!channel.isTextBased() || channel.isThread()) {
      return interaction.editReply({ embeds: [errorEmbed('Please select a text-based channel (not a thread).')] });
    }

    if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.editReply({ embeds: [errorEmbed('I cannot send messages in that channel.')] });
    }

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { modLogChannel: channel.id },
      { upsert: true }
    );

    return interaction.editReply({ embeds: [successEmbed(`Moderation log channel set to **${channel.name}**`)] });
  }
}
