import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, closeActiveCases, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user by their ID')
  .addStringOption(opt => opt.setName('user_id').setDescription('ID of the user to unban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unban'));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('You lack permission to unban members.')] });
  }

  const userId = interaction.options.getString('user_id');
  if (!/^\d{17,20}$/.test(userId)) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid user ID format. Must be a Discord snowflake (17-20 digits).')] });
  }
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!botHasPermissions(interaction.guild, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('I lack Ban Members permission.')] });
  }

  let user;
  try {
    const banList = await interaction.guild.bans.fetch();
    const banEntry = banList.get(userId);
    if (!banEntry) {
      return interaction.editReply({ embeds: [errorEmbed('That user is not banned.')] });
    }
    user = banEntry.user;
    await interaction.guild.bans.remove(userId, reason);
  } catch (err) {
    logger.error(`Failed to unban: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to unban user. Check bot permissions and try again.')] });
  }

  await closeActiveCases(interaction.guildId, userId, 'ban');

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'unban',
    targetId: userId,
    targetTag: user?.tag || userId,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'unban',
    moderatorId: interaction.user.id,
    targetId: userId,
    reason,
  });

  const config = await GuildModel.findOne({ guildId: interaction.guildId });
  if (config?.modLogChannel) {
    const channel = interaction.guild.channels.cache.get(config.modLogChannel);
    if (channel) {
      channel.send({ embeds: [modLogEmbed(caseEntry)] }).catch(() => {});
    }
  }

  await interaction.editReply({ embeds: [successEmbed(`Unbanned ${user?.tag || userId} | Case #${caseEntry.caseNumber}`)] });
}
