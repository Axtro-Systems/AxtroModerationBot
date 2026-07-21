import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { WarnModel } from '../../models/Warn.js';
import { checkWarningEscalation, checkSecurityViolations } from '../../utils/securityUtils.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
  .addBooleanOption(opt => opt.setName('silent').setDescription('Do not DM the user').setRequired(false))
  .addStringOption(opt =>
    opt.setName('severity')
      .setDescription('Severity of the warning (defaults to Minor)')
      .setRequired(false)
      .addChoices(
        { name: 'Minor (1 point)', value: 'minor' },
        { name: 'Moderate (1 point)', value: 'moderate' },
        { name: 'Severe (2 points)', value: 'severe' }
      )
  );

export const cooldown = 2000;

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to warn members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const silent = interaction.options.getBoolean('silent') || false;
  const severity = interaction.options.getString('severity') || 'minor';
  const points = severity === 'severe' ? 2 : 1;

  const targetMember = interaction.options.getMember('user') || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !canActOnMember(interaction.member, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot warn this user.')] });
  }

  const warn = new WarnModel({
    guildId: interaction.guildId,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
    active: true,
    points,
    severity,
  });

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'warn',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: `[${severity.toUpperCase()}] ${reason}`,
  });

  warn.caseNumber = caseEntry.caseNumber;
  await warn.save();

  await logAudit({
    guildId: interaction.guildId,
    action: 'warn',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
    details: `Silent: ${silent} | Severity: ${severity} | Points: ${points}`,
  });

  // Handle immediate severe warning timeout (1 hour = 3600000 ms)
  if (severity === 'severe' && targetMember && targetMember.manageable) {
    const now = Date.now();
    const currentTimeoutEnd = targetMember.communicationDisabledUntilTimestamp || 0;
    const proposedTimeoutEnd = now + 3600000;
    
    if (proposedTimeoutEnd > currentTimeoutEnd) {
      await targetMember.timeout(3600000, `Severe warning: ${reason}`).catch(() => {});
    }
  }

  const activeWarnings = await WarnModel.find({ guildId: interaction.guildId, userId: targetUser.id, active: true }).lean();
  const warningCount = activeWarnings.reduce((sum, w) => sum + (w.points || 1), 0);

  if (!silent && targetMember) {
    try {
      let dmMsg = `⚠️ **Warning Notice**\nYou have been warned in **${interaction.guild.name}** (Case **#${caseEntry.caseNumber}**).\nReason: ${reason}\nSeverity: **${severity.toUpperCase()}**\n\n**Current Warnings:** ${warningCount}/5 points\n\n*If you wish to appeal this warning, run the slash command:* \`/appeal case-id: ${caseEntry.caseNumber} reason: <your reason>\` *in the server.*`;
      if (warningCount === 1) {
        dmMsg += `\n*Note: Your next warning will result in an automatic 1-day mute!*`;
      } else if (warningCount === 4) {
        dmMsg += `\n*Note: Your next warning will result in an automatic 30-day mute!*`;
      }
      await targetMember.send(dmMsg);
    } catch {
      // DM failed, continue
    }
  }

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  let autoAction = null;
  if (targetMember) {
    autoAction = await checkWarningEscalation(interaction.guild, targetMember, interaction.client.user, interaction.channel);
  }

  await checkSecurityViolations(interaction.guild, targetUser.id);

  const reply = `Warned **${targetUser.tag}** with **${severity}** severity (${points} points) | Case #${caseEntry.caseNumber}`;
  const msg = autoAction ? `${reply}\n⚠️ Automatic action: User has been ${autoAction}.` : `${reply}\n⚠️ User now has ${warningCount}/5 warning point(s).`;
  return interaction.editReply({ embeds: [successEmbed(msg)] });
}
