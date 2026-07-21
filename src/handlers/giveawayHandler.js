import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { GiveawayModel } from '../models/Giveaway.js';
import { giveawayManager } from '../utils/GiveawayManager.js';
import { errorEmbed, successEmbed, simpleEmbed } from '../utils/embed.js';
import { logger } from '../utils/logger.js';

export async function handleGiveawayInteraction(interaction, client) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  const customId = interaction.customId;

  // Modal Setup Submission
  if (interaction.isModalSubmit() && customId === 'giveaway_setup_modal') {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      logger.error(`Failed to defer giveaway setup modal: ${err.message}`);
      return;
    }

    const prize = interaction.fields.getTextInputValue('setup_prize');
    const durationStr = interaction.fields.getTextInputValue('setup_duration');
    const winnersStr = interaction.fields.getTextInputValue('setup_winners');
    const targetChannelId = interaction.fields.getTextInputValue('setup_channel')?.trim();
    const templateName = interaction.fields.getTextInputValue('setup_template')?.trim() || null;

    const winnersCount = parseInt(winnersStr);
    if (isNaN(winnersCount) || winnersCount < 1) {
      return interaction.editReply({ embeds: [errorEmbed('Invalid winners count. Please enter a valid number (e.g. 1).')] });
    }

    let channel = interaction.channel;
    if (targetChannelId) {
      channel = interaction.guild.channels.cache.get(targetChannelId);
      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({ embeds: [errorEmbed('Invalid Channel. Please make sure the Channel ID is correct and I have permissions to view it.')] });
      }
    }

    try {
      const { createAndStartGiveaway } = await import('../commands/giveaway/giveaway.js');
      await createAndStartGiveaway(interaction, {
        prize,
        durationStr,
        winnersCount,
        channel,
        templateName
      });
    } catch (err) {
      logger.error(`Modal start error: ${err.message}`, err);
      return interaction.editReply({ embeds: [errorEmbed(`Failed to start giveaway: ${err.message}`)] });
    }
    return;
  }

  // 1. Giveaway Join/Leave Button
  if (customId.startsWith('giveaway_entry_')) {
    const giveawayId = customId.slice('giveaway_entry_'.length);

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      logger.error(`Failed to defer giveaway entry interaction: ${err.message}`);
      return;
    }

    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway) {
      return interaction.editReply({ embeds: [errorEmbed('This giveaway no longer exists in the database.')] });
    }

    if (giveaway.status !== 'active') {
      return interaction.editReply({ embeds: [errorEmbed(`This giveaway is currently **${giveaway.status}**.`)] });
    }

    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('Failed to fetch your server profile. Please try again.')] });
    }

    // Eligibility check
    const eligible = await giveawayManager.checkUserEligibility(member, giveaway);
    if (!eligible) {
      return interaction.editReply({ embeds: [errorEmbed('You do not meet the entry requirements for this giveaway.')] });
    }

    // Concurrency safe entry/exit toggle
    const userId = member.id;
    const isEntered = giveaway.entries.some(e => e.userId === userId);

    if (!isEntered) {
      // Enter user
      const weight = giveawayManager.calculateUserWeight(member, giveaway);
      
      const updated = await GiveawayModel.findOneAndUpdate(
        { giveawayId, 'entries.userId': { $ne: userId }, status: 'active' },
        { $push: { entries: { userId, weight } } },
        { new: true }
      );

      if (!updated) {
        return interaction.editReply({ embeds: [errorEmbed('You have already joined this giveaway!')] });
      }

      giveawayManager.requestMessageUpdate(updated);

      return interaction.editReply({
        embeds: [successEmbed(`🎉 **You have successfully joined the giveaway!**\nYour entry weight is **${weight}**.`)]
      });
    } else {
      // Prompt confirmation to leave
      const confirmButton = new ButtonBuilder()
        .setCustomId(`giveaway_confirm_leave_${giveawayId}`)
        .setLabel('Confirm Leave')
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`giveaway_cancel_leave_${giveawayId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

      const confirmEmbed = simpleEmbed({
        color: 0xFFD700,
        title: 'Leave Giveaway?',
        description: 'Are you sure you want to leave this giveaway? This will clear your entry weights.'
      });

      return interaction.editReply({ embeds: [confirmEmbed], components: [row] });
    }
  }

  // 2. Claim Prize Button
  if (customId.startsWith('giveaway_claim_')) {
    const giveawayId = customId.slice('giveaway_claim_'.length);

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      logger.error(`Failed to defer giveaway claim interaction: ${err.message}`);
      return;
    }

    try {
      await giveawayManager.claimGiveaway(giveawayId, interaction.user.id);
      return interaction.editReply({
        embeds: [successEmbed('🏆 **Congratulations!** You have successfully claimed your prize!')]
      });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed(err.message || 'An error occurred while claiming the prize.')]
      });
    }
  }

  // 3. View Participants Button
  if (customId.startsWith('giveaway_list_users_')) {
    const giveawayId = customId.slice('giveaway_list_users_'.length);

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      logger.error(`Failed to defer giveaway list users interaction: ${err.message}`);
      return;
    }

    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway) {
      return interaction.editReply({ embeds: [errorEmbed('This giveaway no longer exists in the database.')] });
    }

    if (giveaway.entries.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('No one has joined this giveaway yet.')] });
    }

    const list = giveaway.entries.map(e => `<@${e.userId}>`).join(', ');
    const displayList = list.slice(0, 1950);
    const truncated = list.length > 1950 ? '... and more' : '';

    return interaction.editReply({
      embeds: [successEmbed(`👥 **Participants (${giveaway.entries.length}):**\n\n${displayList}${truncated}`).setTitle('Participant List')]
    });
  }

  // 4. Confirm Leave Button
  if (customId.startsWith('giveaway_confirm_leave_')) {
    const giveawayId = customId.slice('giveaway_confirm_leave_'.length);

    try {
      await interaction.deferUpdate();
    } catch (err) {
      logger.error(`Failed to defer confirm leave interaction: ${err.message}`);
      return;
    }

    const userId = interaction.user.id;
    const updated = await GiveawayModel.findOneAndUpdate(
      { giveawayId, 'entries.userId': userId, status: 'active' },
      { $pull: { entries: { userId } } },
      { new: true }
    );

    if (!updated) {
      return interaction.editReply({ embeds: [errorEmbed('You are not in this giveaway or it has already ended.')], components: [] });
    }

    giveawayManager.requestMessageUpdate(updated);

    return interaction.editReply({
      embeds: [successEmbed('❌ **You have successfully left the giveaway.**')],
      components: []
    });
  }

  // 5. Cancel Leave Button
  if (customId.startsWith('giveaway_cancel_leave_')) {
    try {
      await interaction.deferUpdate();
    } catch (err) {
      logger.error(`Failed to defer cancel leave interaction: ${err.message}`);
      return;
    }

    return interaction.editReply({
      embeds: [successEmbed('Cancelled. You are still participating in the giveaway.')],
      components: []
    });
  }
}
