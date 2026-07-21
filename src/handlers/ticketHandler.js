import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
  PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder,
} from 'discord.js';
import { simpleEmbed, successEmbed, errorEmbed } from '../utils/embed.js';
import { TicketSettingsModel } from '../models/TicketSettings.js';
import { TicketModel } from '../models/Ticket.js';
import { generateTranscript, sendTranscript } from '../utils/transcript.js';
import { logger } from '../utils/logger.js';
import { setupState } from '../commands/ticket/ticket.js';

const TICKET_COLOR = 0x5865F2;

export async function handleTicketInteraction(interaction, client) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isModalSubmit()) return;

  const customId = interaction.customId;

  if (interaction.isModalSubmit()) {
    if (customId === 'ticket_close_modal') {
      return handleCloseModalSubmit(interaction, client);
    }
    return;
  }

  if (customId.startsWith('ticket_setup_')) {
    return handleSetupStep(interaction, client);
  }

  if (customId === 'ticket_open' || customId.startsWith('ticket_open_')) {
    return handleOpenTicket(interaction, client);
  }

  if (customId === 'ticket_type_select') {
    return handleTypeSelect(interaction, client);
  }

  if (customId === 'ticket_close') {
    return handleCloseTicket(interaction, client);
  }

  if (customId === 'ticket_close_reason_select') {
    return handleCloseReasonSelect(interaction, client);
  }

  if (customId === 'ticket_claim') {
    return handleClaimTicket(interaction, client);
  }

  if (customId === 'ticket_reopen') {
    return handleReopenTicket(interaction, client);
  }

  if (customId === 'ticket_transcript') {
    return handleTranscriptTicket(interaction, client);
  }

  if (customId === 'ticket_delete') {
    return handleDeleteTicket(interaction, client);
  }

  if (customId === 'ticket_close_confirm') {
    return handleCloseConfirm(interaction, client);
  }

  if (customId === 'ticket_close_cancel' || customId === 'ticket_delete_cancel') {
    const cancelEmbed = simpleEmbed({ color: TICKET_COLOR, title: 'Cancelled', description: 'Action cancelled.' });
    return interaction.update({ embeds: [cancelEmbed], components: [] });
  }

  if (customId === 'ticket_delete_confirm') {
    return handleDeleteConfirm(interaction, client);
  }
}

async function handleSetupStep(interaction, client) {
  const state = setupState.get(interaction.user.id);
  if (!state || state.guildId !== interaction.guildId) {
    return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/ticket setup` again.')], ephemeral: true });
  }

  if (interaction.customId === 'ticket_setup_category') {
    if (!interaction.isChannelSelectMenu()) return;
    const categoryId = interaction.values[0];

    await TicketSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { categoryId }, $setOnInsert: { guildId: interaction.guildId } },
      { upsert: true }
    );

    state.step = 'roles';
    const embed = simpleEmbed({
      color: TICKET_COLOR,
      title: 'Ticket System Setup',
      description: 'Category set! Now select the **staff role(s)** that can view and manage tickets.\n\nSelect one or more roles below.',
    });

    const select = new RoleSelectMenuBuilder()
      .setCustomId('ticket_setup_roles')
      .setPlaceholder('Select staff roles')
      .setMinValues(1)
      .setMaxValues(10);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (interaction.customId === 'ticket_setup_roles') {
    if (!interaction.isRoleSelectMenu()) return;
    const roleIds = interaction.values;

    await TicketSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { staffRoleIds: roleIds } },
      { upsert: true }
    );

    state.step = 'panel';
    const embed = simpleEmbed({
      color: TICKET_COLOR,
      title: 'Ticket System Setup',
      description: 'Staff roles set! Now select the **channel** where the ticket panel should be posted.\n\nThis is optional — you can skip by clicking the "Skip" button below.',
    });

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('ticket_setup_panel')
      .setPlaceholder('Select a channel (or skip)')
      .setChannelTypes(0);

    const skipButton = new ButtonBuilder()
      .setCustomId('ticket_setup_skip_panel')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder().addComponents(channelSelect);
    const row2 = new ActionRowBuilder().addComponents(skipButton);
    return interaction.update({ embeds: [embed], components: [row1, row2] });
  }

  if (interaction.customId === 'ticket_setup_skip_panel' || interaction.customId === 'ticket_setup_panel') {
    if (interaction.isChannelSelectMenu()) {
      await TicketSettingsModel.findOneAndUpdate(
        { guildId: interaction.guildId },
        { $set: { panelChannelId: interaction.values[0] } },
        { upsert: true }
      );
    }

    state.step = 'log';
    const embed = simpleEmbed({
      color: TICKET_COLOR,
      title: 'Ticket System Setup',
      description: 'Almost done! Select a **log channel** for ticket transcripts and activity.\n\nThis is optional — click "Skip" if you don\'t need one.',
    });

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('ticket_setup_log')
      .setPlaceholder('Select a log channel (or skip)')
      .setChannelTypes(0);

    const skipButton = new ButtonBuilder()
      .setCustomId('ticket_setup_skip_log')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder().addComponents(channelSelect);
    const row2 = new ActionRowBuilder().addComponents(skipButton);
    return interaction.update({ embeds: [embed], components: [row1, row2] });
  }

  if (interaction.customId === 'ticket_setup_skip_log' || interaction.customId === 'ticket_setup_log') {
    if (interaction.isChannelSelectMenu()) {
      await TicketSettingsModel.findOneAndUpdate(
        { guildId: interaction.guildId },
        { $set: { logChannelId: interaction.values[0] } },
        { upsert: true }
      );
    }

    const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
    setupState.delete(interaction.user.id);

    const desc = [
      '**Category:** ' + (interaction.guild.channels.cache.get(settings.categoryId)?.name || 'Set'),
      '**Staff Roles:** ' + (settings.staffRoleIds.map(id => '<@&' + id + '>').join(', ') || 'None'),
      '**Panel Channel:** ' + (settings.panelChannelId ? '<#' + settings.panelChannelId + '>' : 'Not set (run `/ticket panel create` to post one)'),
      '**Log Channel:** ' + (settings.logChannelId ? '<#' + settings.logChannelId + '>' : 'Not set'),
    ].join('\n');

    const embed = successEmbed('Ticket system setup complete!\n\n' + desc);
    return interaction.update({ embeds: [embed], components: [] });
  }
}

async function handleOpenTicket(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    logger.error(`Failed to defer open ticket: ${err.message}`);
    return;
  }

  const customId = interaction.customId;
  const panelId = customId.startsWith('ticket_open_') ? customId.slice('ticket_open_'.length) : null;

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings || !settings.categoryId) {
    return interaction.editReply({ embeds: [errorEmbed('Ticket system is not configured. Contact an admin.')] });
  }

  const openTickets = await TicketModel.countDocuments({
    guildId: interaction.guildId,
    openerId: interaction.user.id,
    status: 'open',
  });

  if (openTickets >= (settings.maxTicketsPerUser || 1)) {
    return interaction.editReply({ embeds: [errorEmbed('You already have ' + openTickets + ' open ticket(s). Close it before opening a new one.')] });
  }

  let availableTypes = settings.ticketTypes || [];
  if (panelId) {
    const panel = settings.panels?.find(p => p.id === panelId);
    if (panel?.ticketTypes?.length > 0) {
      availableTypes = availableTypes.filter(t => panel.ticketTypes.includes(t.name));
    }
  }

  if (availableTypes.length > 0) {
    const options = availableTypes.map(t => ({
      label: t.name,
      description: (t.description || '').slice(0, 100) || 'No description',
      value: t.name,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_type_select')
      .setPlaceholder('Select a ticket type')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);
    const embed = simpleEmbed({
      color: TICKET_COLOR,
      title: 'Select Ticket Type',
      description: 'Please choose the type of ticket you want to open.',
    });
    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  try {
    await createTicketChannel(interaction, settings, null, client);
  } catch (err) {
    logger.error(`Failed to open ticket: ${err.message}`);
    const errMsg = { embeds: [errorEmbed('Failed to create ticket. Please try again.')] };
    await interaction.editReply(errMsg).catch(() => {});
  }
}

async function handleTypeSelect(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.error(`Failed to defer type select interaction: ${err.message}`);
    return;
  }
  const typeName = interaction.values[0];
  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });

  await createTicketChannel(interaction, settings, typeName, client);
}

async function createTicketChannel(interaction, settings, typeName, client) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      if (interaction.isButton()) {
        await interaction.deferReply({ ephemeral: true });
      } else {
        await interaction.deferUpdate();
      }
    }
  } catch (err) {
    logger.error(`Failed to defer ticket interaction: ${err.message}`);
    return;
  }

  const creatingEmbed = simpleEmbed({
    color: TICKET_COLOR,
    title: 'Creating Ticket...',
    description: 'Please wait while your ticket is being created.',
  });
  await interaction.editReply({ embeds: [creatingEmbed], components: [] }).catch(() => {});

  let ticketType = null;
  if (typeName && settings.ticketTypes?.length > 0) {
    ticketType = settings.ticketTypes.find(t => t.name === typeName);
  }

  const staffRoleIds = settings.staffRoleIds || [];

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: interaction.guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    },
  ];

  for (const roleId of staffRoleIds) {
    permissionOverwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  if (ticketType?.staffRoleId && !staffRoleIds.includes(ticketType.staffRoleId)) {
    permissionOverwrites.push({
      id: ticketType.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const settingsDoc = await TicketSettingsModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $inc: { ticketCounter: 1 } },
    { new: true }
  );

  const ticketNumber = String(settingsDoc.ticketCounter).padStart(4, '0');
  const safeName = (interaction.user.username || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const channelName = 'ticket-' + safeName + '-' + ticketNumber;

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: channelName,
      type: 0,
      parent: settings.categoryId,
      permissionOverwrites,
      topic: 'Ticket #' + ticketNumber + ' | Opened by ' + interaction.user.tag + ' | Type: ' + (typeName || 'General Support'),
    });
  } catch (err) {
    logger.error('Failed to create ticket channel: ' + err.message);
    return interaction.editReply({ embeds: [errorEmbed('Failed to create the ticket channel. Check my permissions.')] });
  }

  const ticketId = 'TICKET-' + ticketNumber;
  const ticket = new TicketModel({
    ticketId,
    guildId: interaction.guildId,
    channelId: channel.id,
    openerId: interaction.user.id,
    type: typeName || 'General Support',
    status: 'open',
    openedAt: new Date(),
  });
  await ticket.save();

  const welcomeEmbed = new EmbedBuilder()
    .setColor(TICKET_COLOR)
    .setTitle('Ticket #' + ticketNumber + ' - ' + ticket.type)
    .setDescription('Welcome, <@' + interaction.user.id + '>!\n\nSupport staff will be with you shortly. Please describe your issue in detail.\n\n**Type:** ' + ticket.type)
    .addFields(
      { name: 'Status', value: 'Open', inline: true },
      { name: 'Opened', value: '<t:' + Math.floor(Date.now() / 1000) + ':f>', inline: true },
    )
    .setFooter({ text: 'Ticket ID: ' + ticketId })
    .setTimestamp();

  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('🔒 Close Ticket')
    .setStyle(ButtonStyle.Danger);

  const claimButton = new ButtonBuilder()
    .setCustomId('ticket_claim')
    .setLabel('📋 Claim Ticket')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(closeButton, claimButton);
  const staffMentions = staffRoleIds.map(id => '<@&' + id + '>').join(' ');
  await channel.send({ content: '<@' + interaction.user.id + '> - ' + staffMentions, embeds: [welcomeEmbed], components: [row] });

  const success = successEmbed('Your ticket has been created: ' + channel);
  await interaction.editReply({ embeds: [success] });
}

async function handleCloseTicket(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    logger.error(`Failed to defer close ticket: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed('This is not a ticket channel.')] });
  }

  const isOpener = interaction.user.id === ticket.openerId;
  const isStaff = await isTicketStaff(interaction);
  if (!isOpener && !isStaff) {
    return interaction.editReply({ embeds: [errorEmbed('Only the ticket opener or support staff can close this ticket.')] });
  }

  if (ticket.status !== 'open') {
    return interaction.editReply({ embeds: [errorEmbed('This ticket is already closed.')] });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_close_reason_select')
    .setPlaceholder('Select a reason for closing this ticket')
    .addOptions([
      { label: 'Issue Resolved', value: 'resolved', description: 'The issue has been successfully resolved.' },
      { label: 'No Response / Inactivity', value: 'inactivity', description: 'The opener has stopped responding.' },
      { label: 'Spam / Duplicate', value: 'spam', description: 'This ticket is spam or a duplicate.' },
      { label: 'Other / Custom Reason', value: 'other', description: 'Another reason not listed here.' },
    ]);

  const row = new ActionRowBuilder().addComponents(select);
  const embed = simpleEmbed({
    color: 0xFFA500,
    title: 'Close Ticket',
    description: 'Please select a reason for closing this ticket below.',
  });

  return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleCloseReasonSelect(interaction, client) {
  const reasonValue = interaction.values[0];

  if (reasonValue === 'other') {
    const modal = new ModalBuilder()
      .setCustomId('ticket_close_modal')
      .setTitle('Close Ticket - Custom Reason');

    const reasonInput = new TextInputBuilder()
      .setCustomId('custom_reason_input')
      .setLabel('Reason for closing')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Type your custom closing reason here...')
      .setRequired(true)
      .setMaxLength(500);

    const row = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(row);

    try {
      await interaction.showModal(modal);
    } catch (err) {
      logger.error(`Failed to show close reason modal: ${err.message}`);
    }
    return;
  }

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.error(`Failed to defer close reason select: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) return;

  const reasonMap = {
    resolved: 'Issue Resolved',
    inactivity: 'No Response / Inactivity',
    spam: 'Spam / Duplicate Ticket'
  };
  const closeReason = reasonMap[reasonValue] || 'No reason provided';

  await closeTicket(interaction, ticket, closeReason, client);
}

async function handleCloseModalSubmit(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.error(`Failed to defer close modal submit: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) return;

  const closeReason = interaction.fields.getTextInputValue('custom_reason_input') || 'No reason provided';

  await closeTicket(interaction, ticket, closeReason, client);
}

async function closeTicket(interaction, ticket, closeReason, client) {
  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closeReason = closeReason;
  ticket.claimedBy = null;
  await ticket.save();

  try {
    await interaction.channel.permissionOverwrites.edit(ticket.openerId, {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true
    });
  } catch (err) {
    logger.error(`Failed to update permissions on ticket close: ${err.message}`);
  }

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (settings?.logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(settings.logChannelId);
    if (logChannel) {
      try {
        const logEmbed = simpleEmbed({
          color: 0xFFA500,
          title: `Ticket Closed - ${ticket.ticketId}`,
          description: `**Opener:** <@${ticket.openerId}>\n**Type:** ${ticket.type}\n**Closed by:** ${interaction.user.tag}\n**Reason:** ${closeReason}`,
          timestamp: new Date(),
        });
        await logChannel.send({ embeds: [logEmbed] });
      } catch (err) {
        logger.error(`Failed to send log embed: ${err.message}`);
      }
    }
  }

  const reopenButton = new ButtonBuilder()
    .setCustomId('ticket_reopen')
    .setLabel('🔓 Reopen Ticket')
    .setStyle(ButtonStyle.Primary);

  const transcriptButton = new ButtonBuilder()
    .setCustomId('ticket_transcript')
    .setLabel('📜 Transcript')
    .setStyle(ButtonStyle.Secondary);

  const deleteButton = new ButtonBuilder()
    .setCustomId('ticket_delete')
    .setLabel('🗑️ Delete Ticket')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(reopenButton, transcriptButton, deleteButton);

  await interaction.editReply({
    embeds: [simpleEmbed({ color: TICKET_COLOR, title: 'Closing Ticket...', description: 'Ticket channel is now closed.' })],
    components: []
  }).catch(() => {});

  // Remove old buttons from previous messages in channel
  const messages = await interaction.channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages) {
    const welcomeMsg = messages.find(m => m.embeds?.[0]?.footer?.text?.startsWith('Ticket ID:'));
    if (welcomeMsg) {
      await welcomeMsg.edit({ components: [] }).catch(() => {});
    }
  }

  await interaction.channel.send({
    embeds: [simpleEmbed({
      color: 0xFFA500,
      title: 'Ticket Closed Controls',
      description: 'This ticket has been closed by <@' + interaction.user.id + '>.\n\n• **Reopen:** Support staff can reopen this ticket\n• **Transcript:** Export HTML transcript\n• **Delete:** Support staff can delete this channel',
    })],
    components: [row],
  }).catch(() => {});
}

async function handleClaimTicket(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    logger.error(`Failed to defer claim ticket: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed('This is not a ticket channel.')] });
  }

  if (!await isTicketStaff(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('Only support staff members can claim tickets.')] });
  }

  if (ticket.claimedBy) {
    if (ticket.claimedBy === interaction.user.id) {
      const embed = successEmbed('You have already claimed this ticket.');
      return interaction.editReply({ embeds: [embed] });
    }
    return interaction.editReply({ embeds: [errorEmbed('This ticket is already claimed by <@' + ticket.claimedBy + '>.')] });
  }

  ticket.claimedBy = interaction.user.id;
  await ticket.save();

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  const staffRoleIds = settings?.staffRoleIds || [];

  try {
    const topic = 'Ticket #' + ticket.ticketId.split('-')[1] + ' | Opened by <@' + ticket.openerId + '> | Claimed by ' + interaction.user.tag + ' | Type: ' + ticket.type;
    await interaction.channel.setTopic(topic);
  } catch {}

  try {
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    for (const roleId of staffRoleIds) {
      await interaction.channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true
      });
    }
  } catch (err) {
    logger.error(`Failed to update permissions on ticket claim: ${err.message}`);
  }

  await interaction.editReply({ embeds: [successEmbed('You have successfully claimed this ticket.')] }).catch(() => {});

  const claimEmbed = simpleEmbed({
    color: 0x00FF7F,
    title: 'Ticket Claimed',
    description: `This ticket has been claimed by <@${interaction.user.id}>.\nOnly this staff member can now send messages in this channel.`,
    timestamp: new Date()
  });
  await interaction.channel.send({ embeds: [claimEmbed] }).catch(() => {});
}

async function handleReopenTicket(interaction, client) {
  try {
    await interaction.deferReply();
  } catch (err) {
    logger.error(`Failed to defer reopen ticket: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed('This is not a ticket channel.')] });
  }

  if (!await isTicketStaff(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('Only support staff members can reopen tickets.')] });
  }

  if (ticket.status !== 'closed') {
    return interaction.editReply({ embeds: [errorEmbed('This ticket is already open.')] });
  }

  ticket.status = 'open';
  ticket.closedAt = null;
  ticket.claimedBy = null;
  await ticket.save();

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  const staffRoleIds = settings?.staffRoleIds || [];

  try {
    await interaction.channel.permissionOverwrites.edit(ticket.openerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    
    for (const roleId of staffRoleIds) {
      await interaction.channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    const topic = 'Ticket #' + ticket.ticketId.split('-')[1] + ' | Opened by <@' + ticket.openerId + '> | Type: ' + ticket.type;
    await interaction.channel.setTopic(topic);
  } catch {}

  // Wipe closed control buttons from the closed message
  await interaction.message?.edit({ components: [] }).catch(() => {});

  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('🔒 Close Ticket')
    .setStyle(ButtonStyle.Danger);

  const claimButton = new ButtonBuilder()
    .setCustomId('ticket_claim')
    .setLabel('📋 Claim Ticket')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(closeButton, claimButton);

  const reopenEmbed = simpleEmbed({
    color: 0x00FF7F,
    title: 'Ticket Reopened',
    description: `This ticket has been reopened by <@${interaction.user.id}>.\n<@${ticket.openerId}> can send messages again.`,
    timestamp: new Date()
  });

  await interaction.editReply({ embeds: [reopenEmbed], components: [row] }).catch(() => {});
}

async function handleTranscriptTicket(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed('This is not a ticket channel.')] });
  }

  try {
    const transcriptHtml = await generateTranscript(interaction.channel);
    const attachment = new AttachmentBuilder(Buffer.from(transcriptHtml, 'utf-8'), { name: `transcript-${ticket.ticketId}.html` });

    const embed = simpleEmbed({
      color: TICKET_COLOR,
      title: `Ticket Transcript - ${ticket.ticketId}`,
      description: `Here is the transcript for ticket **#${ticket.ticketId}**.`,
    });

    return interaction.editReply({ embeds: [embed], files: [attachment] });
  } catch (err) {
    logger.error(`Transcript generation error: ${err.message}`);
    return interaction.editReply({ embeds: [errorEmbed('Failed to generate transcript.')] });
  }
}

async function handleDeleteTicket(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    logger.error(`Failed to defer delete ticket: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed('This is not a ticket channel.')] });
  }

  if (!await isTicketStaff(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('Only support staff members can delete tickets.')] });
  }

  if (ticket.status !== 'closed') {
    return interaction.editReply({ embeds: [errorEmbed('Close the ticket first before deleting.')] });
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId('ticket_delete_confirm')
    .setLabel('✅ Confirm Delete')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId('ticket_delete_cancel')
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
  const embed = simpleEmbed({
    color: 0xFF0000,
    title: 'Confirm Delete',
    description: 'This will permanently delete the channel. A transcript will be saved first.',
  });
  return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleCloseConfirm(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.error(`Failed to defer close confirm: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) return;

  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.claimedBy = null;
  await ticket.save();

  try {
    await interaction.channel.permissionOverwrites.edit(ticket.openerId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true });
  } catch {}

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (settings?.logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(settings.logChannelId);
    if (logChannel) {
      try {
        const logEmbed = simpleEmbed({
          color: 0xFFA500,
          title: 'Ticket Closed - ' + ticket.ticketId,
          description: '**Opener:** <@' + ticket.openerId + '>\n**Type:** ' + ticket.type + '\n**Closed by:** ' + interaction.user.tag,
          timestamp: new Date(),
        });
        await logChannel.send({ embeds: [logEmbed] });
      } catch {}
    }
  }

  const reopenButton = new ButtonBuilder()
    .setCustomId('ticket_reopen')
    .setLabel('🔓 Reopen Ticket')
    .setStyle(ButtonStyle.Primary);

  const transcriptButton = new ButtonBuilder()
    .setCustomId('ticket_transcript')
    .setLabel('📜 Transcript')
    .setStyle(ButtonStyle.Secondary);

  const deleteButton = new ButtonBuilder()
    .setCustomId('ticket_delete')
    .setLabel('🗑️ Delete Ticket')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(reopenButton, transcriptButton, deleteButton);

  await interaction.editReply({ embeds: [simpleEmbed({ color: TICKET_COLOR, title: 'Closing Ticket...', description: 'Ticket channel is now closed.' })], components: [] }).catch(() => {});
  await interaction.message?.edit({ components: [] }).catch(() => {});

  await interaction.channel.send({
    embeds: [simpleEmbed({
      color: 0xFFA500,
      title: 'Ticket Closed Controls',
      description: 'This ticket has been closed by <@' + interaction.user.id + '>.\n\n• **Reopen:** Support staff can reopen this ticket\n• **Transcript:** Export HTML transcript\n• **Delete:** Support staff can delete this channel',
    })],
    components: [row],
  }).catch(() => {});
}

async function handleDeleteConfirm(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.error(`Failed to defer delete confirm: ${err.message}`);
    return;
  }

  const ticket = await TicketModel.findOne({ channelId: interaction.channelId, guildId: interaction.guildId });
  if (!ticket) return;

  if (!await isTicketStaff(interaction)) {
    return interaction.followUp({ embeds: [errorEmbed('Only support staff members can delete tickets.')], ephemeral: true });
  }

  const transcript = await generateTranscript(interaction.channel);
  const file = await sendTranscript(interaction.channel, ticket, transcript, client);

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (settings?.logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(settings.logChannelId);
    if (logChannel) {
      try {
        const logEmbed = simpleEmbed({
          color: 0xFF0000,
          title: 'Ticket Deleted - ' + ticket.ticketId,
          description: '**Opener:** <@' + ticket.openerId + '>\n**Type:** ' + ticket.type + '\n**Deleted by:** ' + interaction.user.tag,
          timestamp: new Date(),
        });
        await logChannel.send({ embeds: [logEmbed], files: [file] });
      } catch {}
    }
  }

  ticket.status = 'deleted';
  await ticket.save();

  const deleteEmbed = simpleEmbed({
    color: 0xFF0000,
    title: 'Deleting Channel...',
    description: 'This channel will be permanently deleted in 3 seconds.',
  });
  await interaction.editReply({ embeds: [deleteEmbed], components: [] }).catch(() => {});
  await interaction.channel.send({ embeds: [deleteEmbed] }).catch(() => {});

  setTimeout(async () => {
    try {
      await interaction.channel.delete('Ticket closed and deleted');
    } catch (err) {
      logger.error('Failed to delete ticket channel: ' + err.message);
    }
  }, 3000);
}

async function isTicketStaff(interaction) {
  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings) return false;

  const staffRoleIds = settings.staffRoleIds || [];
  if (staffRoleIds.length === 0) {
    return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  return interaction.member.roles.cache.some(r => staffRoleIds.includes(r.id));
}
