import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';

export const data = new SlashCommandBuilder()
  .setName('note')
  .setDescription('Add a staff note to a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to add a note to').setRequired(true))
  .addStringOption(opt => opt.setName('note').setDescription('The note content').setRequired(true));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to add notes.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const note = interaction.options.getString('note', true);

  const targetMember = interaction.options.getMember('user') || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !canActOnMember(interaction.member, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot add a note for this user.')] });
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'note',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: note,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'note',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason: note,
    details: 'Staff note added',
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] }).catch(() => {});
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Note added for **${targetUser.tag}** | Case #${caseEntry.caseNumber}`)] });
}
