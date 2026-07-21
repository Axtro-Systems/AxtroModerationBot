import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { AppealModel } from '../models/Appeal.js';
import { WarnModel } from '../models/Warn.js';
import { CaseModel } from '../models/Case.js';
import { GuildModel } from '../models/Guild.js';
import { AutoModTrackerModel } from '../models/AutoModTracker.js';
import { StrikeModel } from '../models/Strike.js';
import { createUnifiedModEmbed } from '../utils/modLogEmbed.js';
import { createCase } from '../utils/caseUtils.js';
import { logger } from '../utils/logger.js';
import { errorEmbed, successEmbed } from '../utils/embed.js';

export async function handleAppealInteraction(interaction, client) {
  const customId = interaction.customId;

  // 1. User clicks "📝 Submit Explanation" button -> Show Modal Form
  if (interaction.isButton() && customId.startsWith('appeal_open_modal_')) {
    const parts = customId.replace('appeal_open_modal_', '').split('_');
    const guildId = parts[0];
    const caseNumber = parts[1];

    const modal = new ModalBuilder()
      .setCustomId(`appeal_modal_submit_${guildId}_${caseNumber}`)
      .setTitle('Appeal Explanation');

    const explanationInput = new TextInputBuilder()
      .setCustomId('appeal_explanation_text')
      .setLabel('Why should your punishment be reverted?')
      .setPlaceholder('Provide a detailed explanation and any context to help staff review your appeal...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(15)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(explanationInput));

    return interaction.showModal(modal);
  }

  // 2. User submits Modal -> Save & Post to Appeals Channel
  if (interaction.isModalSubmit() && customId.startsWith('appeal_modal_submit_')) {
    await interaction.deferReply({ ephemeral: true });

    const parts = customId.replace('appeal_modal_submit_', '').split('_');
    const guildId = parts[0];
    const caseNumber = parseInt(parts[1], 10);

    const explanation = interaction.fields.getTextInputValue('appeal_explanation_text');

    const caseLog = await CaseModel.findOne({ guildId, caseNumber });
    if (!caseLog) {
      return interaction.editReply({ embeds: [errorEmbed(`Case #${caseNumber} not found.`)] });
    }

    const appeal = new AppealModel({
      guildId,
      userId: interaction.user.id,
      caseId: String(caseNumber),
      type: caseLog.type === 'ban' || caseLog.type === 'tempban' ? 'ban' : 'warn',
      reason: explanation
    });
    await appeal.save();

    // Fetch Guild & Appeals Channel
    const guild = client.guilds.cache.get(guildId);
    const guildConfig = await GuildModel.findOne({ guildId });
    const targetChannelId = guildConfig?.appealChannel;
    
    let appealChannel = null;
    if (guild && targetChannelId) {
      appealChannel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
    }

    const reviewEmbed = createUnifiedModEmbed({
      title: `📁 Appeal Request: Case #${caseNumber}`,
      description: `A user has submitted an appeal for review.`,
      colorType: 'warn',
      fields: [
        { name: 'User', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
        { name: 'Punishment Type', value: caseLog.type.toUpperCase(), inline: true },
        { name: 'Status', value: '⏳ `PENDING STAFF REVIEW`', inline: true },
        { name: 'Original Reason', value: caseLog.reason || 'None', inline: false },
        { name: 'Appeal Explanation', value: explanation, inline: false },
      ]
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appeal_approve_${appeal._id}`).setLabel('✅ Approve Appeal').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`appeal_reject_${appeal._id}`).setLabel('❌ Reject Appeal').setStyle(ButtonStyle.Danger)
    );

    if (appealChannel) {
      await appealChannel.send({ embeds: [reviewEmbed], components: [row] }).catch(() => {});
    }

    return interaction.editReply({
      embeds: [successEmbed(`✅ Your appeal for Case #${caseNumber} has been submitted to server staff!`)]
    });
  }

  // 3. Staff Approve / Reject Buttons (Updates embed in place)
  if (interaction.isButton() && (customId.startsWith('appeal_approve_') || customId.startsWith('appeal_reject_'))) {
    await interaction.deferReply({ ephemeral: true });

    const parts = customId.split('_');
    const action = parts[1]; // 'approve' or 'reject'
    const appealId = parts[2];

    const appeal = await AppealModel.findById(appealId);
    if (!appeal) {
      return interaction.editReply({ content: 'Appeal document not found.' });
    }

    if (appeal.status !== 'pending') {
      return interaction.editReply({ content: `This appeal has already been resolved (${appeal.status}).` });
    }

    const guild = interaction.guild;
    const targetMember = await guild.members.fetch(appeal.userId).catch(() => null);

    if (action === 'approve') {
      appeal.status = 'approved';
      appeal.resolvedBy = interaction.user.id;
      appeal.resolvedAt = new Date();
      await appeal.save();

      let success = false;
      let errMessage = '';

      if (appeal.type === 'mute' || appeal.type === 'warn') {
        try {
          if (targetMember && targetMember.communicationDisabledUntilTimestamp > Date.now()) {
            await targetMember.timeout(null, `Appeal Approved by ${interaction.user.tag}`);
          }
          await WarnModel.updateMany(
            { guildId: guild.id, userId: appeal.userId, active: true },
            { $set: { active: false } }
          );
          await AutoModTrackerModel.deleteMany({ guildId: guild.id, userId: appeal.userId });
          await StrikeModel.updateOne({ guildId: guild.id, userId: appeal.userId }, { $set: { warningsCount: 0 } });
          success = true;
        } catch (err) {
          errMessage = err.message;
        }
      } else if (appeal.type === 'ban') {
        try {
          await guild.bans.remove(appeal.userId, `Appeal Approved by ${interaction.user.tag}`);
          success = true;
        } catch (err) {
          errMessage = err.message;
        }
      }

      if (success) {
        const resolutionCase = await createCase({
          guildId: guild.id,
          type: appeal.type === 'ban' ? 'unban' : 'unmute',
          targetId: appeal.userId,
          targetTag: targetMember?.user?.tag || appeal.userId,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          reason: `Approved appeal for Case #${appeal.caseId}. Reverted punishment.`,
        });

        await logResolution(guild, resolutionCase, 'unmute');

        // Update the embed message in place to show Approved
        if (interaction.message) {
          const updatedEmbed = createUnifiedModEmbed({
            title: `📁 Appeal Request: Case #${appeal.caseId} [APPROVED]`,
            description: `This appeal has been **APPROVED** by <@${interaction.user.id}>.`,
            colorType: 'unmute',
            fields: [
              { name: 'User', value: `<@${appeal.userId}>`, inline: true },
              { name: 'Status', value: `✅ APPROVED by <@${interaction.user.id}>`, inline: true },
              { name: 'Appeal Explanation', value: appeal.reason, inline: false },
            ]
          });
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('approved_disabled').setLabel('✅ Approved').setStyle(ButtonStyle.Success).setDisabled(true)
          );
          await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});
        }

        await interaction.editReply({ content: '✅ Appeal approved and punishment reverted successfully.' });

        try {
          const userEmbed = createUnifiedModEmbed({
            title: '✅ Appeal Approved',
            description: `Your appeal for Case #${appeal.caseId} in **${guild.name}** has been approved! Your punishment has been reverted.`,
            colorType: 'unmute'
          });
          const user = await client.users.fetch(appeal.userId).catch(() => null);
          if (user) await user.send({ embeds: [userEmbed] }).catch(() => {});
        } catch {}
      } else {
        appeal.status = 'pending';
        await appeal.save();
        return interaction.editReply({ content: `❌ Failed to revert punishment: ${errMessage}` });
      }
    } else if (action === 'reject') {
      appeal.status = 'rejected';
      appeal.resolvedBy = interaction.user.id;
      appeal.resolvedAt = new Date();
      await appeal.save();

      // Update embed message in place to show Rejected
      if (interaction.message) {
        const updatedEmbed = createUnifiedModEmbed({
          title: `📁 Appeal Request: Case #${appeal.caseId} [REJECTED]`,
          description: `This appeal has been **REJECTED** by <@${interaction.user.id}>.`,
          colorType: 'ban',
          fields: [
            { name: 'User', value: `<@${appeal.userId}>`, inline: true },
            { name: 'Status', value: `❌ REJECTED by <@${interaction.user.id}>`, inline: true },
            { name: 'Appeal Explanation', value: appeal.reason, inline: false },
          ]
        });
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rejected_disabled').setLabel('❌ Rejected').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});
      }

      await interaction.editReply({ content: '❌ Appeal rejected.' });

      try {
        const userEmbed = createUnifiedModEmbed({
          title: '❌ Appeal Rejected',
          description: `Your appeal for Case #${appeal.caseId} in **${guild.name}** has been rejected by staff.`,
          colorType: 'ban'
        });
        const user = await client.users.fetch(appeal.userId).catch(() => null);
        if (user) await user.send({ embeds: [userEmbed] }).catch(() => {});
      } catch {}
    }
  }
}

async function logResolution(guild, caseEntry, colorType) {
  try {
    const guildConfig = await GuildModel.findOne({ guildId: guild.id });
    const logChannelId = guildConfig?.modLogChannel || guildConfig?.auditChannel;
    if (logChannelId) {
      const logChannel = guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const fields = [
          { name: 'Target', value: `<@${caseEntry.targetId}>`, inline: true },
          { name: 'Moderator', value: `<@${caseEntry.moderatorId}>`, inline: true },
          { name: 'Reason', value: caseEntry.reason, inline: false },
        ];
        const embed = createUnifiedModEmbed({
          title: `Case #${caseEntry.caseNumber} | ${caseEntry.type.toUpperCase()}`,
          description: `Action resolved via appeal request.`,
          colorType,
          fields
        });
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch {}
}
