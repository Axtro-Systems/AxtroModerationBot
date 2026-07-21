import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed, successEmbed, simpleEmbed } from '../../utils/embed.js';
import { GiveawayModel } from '../../models/Giveaway.js';
import { GiveawayTemplateModel } from '../../models/GiveawayTemplate.js';
import { giveawayManager } from '../../utils/GiveawayManager.js';
import { logger } from '../../utils/logger.js';

export const defer = false; // Disable auto-defer to allow showing Modals

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Manage the server giveaway system')
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Create a giveaway interactively using a modal form')
  )
  .addSubcommand(sub =>
    sub.setName('start')
      .setDescription('Start a giveaway via command options')
      .addStringOption(opt => opt.setName('prize').setDescription('What is the giveaway prize?').setRequired(true))
      .addStringOption(opt => opt.setName('duration').setDescription('How long? e.g. "1d", "2h", "10m"').setRequired(true))
      .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to host in (defaults to current)').addChannelTypes(ChannelType.GuildText))
      .addStringOption(opt => opt.setName('required-roles').setDescription('Roles required to join (comma separated IDs/mentions)'))
      .addStringOption(opt => opt.setName('blacklist-roles').setDescription('Roles blocked from joining (comma separated IDs/mentions)'))
      .addStringOption(opt => opt.setName('whitelist-roles').setDescription('Roles that bypass eligibility requirements (comma separated)'))
      .addStringOption(opt => opt.setName('min-account-age').setDescription('Min account age (e.g. "7d", "30d")'))
      .addStringOption(opt => opt.setName('min-join-date').setDescription('Min server membership duration (e.g. "1d", "7d")'))
      .addStringOption(opt => opt.setName('bonus-roles').setDescription('Bonus entries setup. Format: "roleId:weight,roleId:weight"'))
      .addIntegerOption(opt => opt.setName('booster-bonus').setDescription('Extra entries given to server boosters (weight)'))
      .addStringOption(opt => opt.setName('claim-time').setDescription('Claim window duration. e.g. "2h", "24h"'))
      .addBooleanOption(opt => opt.setName('dm-notify').setDescription('Send DMs to winners? (default: true)'))
      .addBooleanOption(opt => opt.setName('show-participants').setDescription('Show View Participants button next to enter? (default: true)'))
      .addStringOption(opt => opt.setName('embed-color').setDescription('Hex color code (e.g. #FFD700)'))
      .addStringOption(opt => opt.setName('image-url').setDescription('Image URL for embed'))
      .addStringOption(opt => opt.setName('thumbnail-url').setDescription('Thumbnail URL for embed'))
      .addStringOption(opt => opt.setName('footer-text').setDescription('Footer text for embed'))
      .addStringOption(opt => opt.setName('start-delay').setDescription('Delay start of giveaway (e.g. "1h", "10m")'))
      .addStringOption(opt => opt.setName('template').setDescription('Load settings from a giveaway template').setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('end')
      .setDescription('Force-end a giveaway early')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to end').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('reroll')
      .setDescription('Reroll winner(s) for a giveaway')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to reroll').setRequired(true).setAutocomplete(true))
      .addIntegerOption(opt => opt.setName('count').setDescription('Number of winners to reroll').setMinValue(1))
      .addStringOption(opt => opt.setName('users').setDescription('Disqualify and reroll specific user IDs (comma separated)'))
  )
  .addSubcommand(sub =>
    sub.setName('edit')
      .setDescription('Modify an active giveaway')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to edit').setRequired(true).setAutocomplete(true))
      .addStringOption(opt => opt.setName('prize').setDescription('New prize'))
      .addStringOption(opt => opt.setName('duration').setDescription('New total duration or change (e.g. "2h", "+30m", "-10m")'))
      .addIntegerOption(opt => opt.setName('winners').setDescription('New winner count').setMinValue(1))
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('Show all active giveaways in the server')
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Cancel a giveaway and delete its message')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to cancel/delete').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('pause')
      .setDescription('Pause giveaway countdown')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to pause').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('resume')
      .setDescription('Resume a paused giveaway')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway to resume').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('stats')
      .setDescription('Check entries count and user giveaway stats')
      .addStringOption(opt => opt.setName('giveaway-id').setDescription('Select the giveaway message').setAutocomplete(true))
      .addUserOption(opt => opt.setName('user').setDescription('The user whose history to check'))
  )
  .addSubcommandGroup(group =>
    group.setName('template')
      .setDescription('Manage giveaway templates')
      .addSubcommand(sub =>
        sub.setName('save')
          .setDescription('Save settings as a template')
          .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true))
          .addStringOption(opt => opt.setName('required-roles').setDescription('Roles required to join (comma separated IDs/mentions)'))
          .addStringOption(opt => opt.setName('blacklist-roles').setDescription('Roles blocked from joining (comma separated IDs/mentions)'))
          .addStringOption(opt => opt.setName('whitelist-roles').setDescription('Roles that bypass eligibility requirements'))
          .addStringOption(opt => opt.setName('min-account-age').setDescription('Min account age (e.g. "7d", "30d")'))
          .addStringOption(opt => opt.setName('min-join-date').setDescription('Min server membership duration (e.g. "1d", "7d")'))
          .addStringOption(opt => opt.setName('bonus-roles').setDescription('Bonus entries setup. Format: "roleId:weight,roleId:weight"'))
          .addIntegerOption(opt => opt.setName('booster-bonus').setDescription('Extra entries for server boosters'))
          .addStringOption(opt => opt.setName('claim-time').setDescription('Claim window duration. e.g. "2h", "24h"'))
          .addStringOption(opt => opt.setName('embed-color').setDescription('Hex color code (e.g. #FFD700)'))
          .addStringOption(opt => opt.setName('thumbnail-url').setDescription('Thumbnail URL'))
          .addStringOption(opt => opt.setName('footer-text').setDescription('Footer text'))
          .addBooleanOption(opt => opt.setName('dm-notify').setDescription('Send DMs to winners? (default: true)'))
          .addBooleanOption(opt => opt.setName('show-participants').setDescription('Show View Participants button? (default: true)'))
      )
      .addSubcommand(sub =>
        sub.setName('delete')
          .setDescription('Delete a template')
          .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('list')
          .setDescription('List all templates configured in the server')
      )
  );

export async function execute(interaction, client) {
  const subGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // If executing setup subcommand, do NOT defer reply to allow modal to render
  if (sub === 'setup' && !subGroup) {
    if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('You do not have permission to manage giveaways.')], ephemeral: true });
    }
    return handleSetup(interaction);
  }

  // Defer all other subcommands manually
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    logger.error(`Failed manual command defer: ${err.message}`);
    return;
  }

  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage giveaways.')] });
  }

  if (subGroup === 'template') {
    switch (sub) {
      case 'save': return handleTemplateSave(interaction);
      case 'delete': return handleTemplateDelete(interaction);
      case 'list': return handleTemplateList(interaction);
    }
  }

  switch (sub) {
    case 'start': return handleStart(interaction);
    case 'end': return handleEnd(interaction);
    case 'reroll': return handleReroll(interaction);
    case 'edit': return handleEdit(interaction);
    case 'list': return handleList(interaction);
    case 'delete': return handleDelete(interaction);
    case 'pause': return handlePause(interaction);
    case 'resume': return handleResume(interaction);
    case 'stats': return handleStats(interaction);
  }
}

// Autocomplete Handler
export async function autocomplete(interaction, client) {
  const focusedOption = interaction.options.getFocused(true);
  const focusedValue = focusedOption.value;
  const guildId = interaction.guildId;

  if (focusedOption.name === 'giveaway-id') {
    const giveaways = await GiveawayModel.find({
      guildId,
      $or: [
        { prize: { $regex: focusedValue, $options: 'i' } },
        { giveawayId: { $regex: focusedValue, $options: 'i' } }
      ]
    }).sort({ createdAt: -1 }).limit(25).lean();

    const choices = giveaways.map(g => ({
      name: `${g.prize.slice(0, 40)}... (ID: ${g.giveawayId}) [${g.status}]`,
      value: g.giveawayId
    }));
    return interaction.respond(choices).catch(() => {});
  }

  if (focusedOption.name === 'template') {
    const templates = await GiveawayTemplateModel.find({
      guildId,
      name: { $regex: focusedValue, $options: 'i' }
    }).limit(25).lean();

    const choices = templates.map(t => ({
      name: t.name,
      value: t.name
    }));
    return interaction.respond(choices).catch(() => {});
  }
}

// Helper: parse duration strings to ms
function parseDuration(str) {
  if (!str) return null;
  const regex = /(\d+)\s*(d|h|m|s)/g;
  let ms = 0;
  let match;
  let matched = false;
  while ((match = regex.exec(str.toLowerCase())) !== null) {
    matched = true;
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'd': ms += value * 24 * 60 * 60 * 1000; break;
      case 'h': ms += value * 60 * 60 * 1000; break;
      case 'm': ms += value * 60 * 1000; break;
      case 's': ms += value * 1000; break;
    }
  }
  return matched ? ms : null;
}

// Helper: parse comma-separated role IDs/mentions
function parseRoles(str) {
  if (!str) return [];
  return str.split(',')
    .map(s => s.trim().replace(/[<@&>]/g, ''))
    .filter(s => /^\d{17,20}$/.test(s));
}

// Helper: parse bonus roles "roleId:weight,roleId:weight"
function parseBonusRoles(str) {
  if (!str) return [];
  const parts = str.split(',');
  const results = [];
  for (const part of parts) {
    const subParts = part.trim().split(':');
    if (subParts.length === 2) {
      const roleId = subParts[0].trim().replace(/[<@&>]/g, '');
      const weight = parseInt(subParts[1].trim());
      if (/^\d{17,20}$/.test(roleId) && !isNaN(weight)) {
        results.push({ roleId, weight });
      }
    }
  }
  return results;
}

// Helper: create and launch giveaway (reused by slash options and modal submit)
export async function createAndStartGiveaway(interaction, options) {
  const {
    prize,
    durationStr,
    winnersCount,
    channel,
    templateName,
    requiredRoles,
    blacklistRoles,
    whitelistRoles,
    minAccountAge,
    minJoinDate,
    bonusRoles,
    boosterBonus,
    claimTimeLimit,
    dmNotify,
    embedColor,
    imageUrl,
    thumbnailUrl,
    footerText,
    startDelayMs,
    showParticipants = true
  } = options;

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid duration format. Use e.g. "1d", "2h", "10m".')] });
  }

  // Load Template if specified
  let template = null;
  if (templateName) {
    template = await GiveawayTemplateModel.findOne({ guildId: interaction.guildId, name: templateName });
    if (!template) {
      return interaction.editReply({ embeds: [errorEmbed(`Template \`${templateName}\` not found.`)] });
    }
  }

  // Merge/Retrieve settings
  const finalRequiredRoles = requiredRoles || template?.requiredRoles || [];
  const finalBlacklistRoles = blacklistRoles || template?.blacklistRoles || [];
  const finalWhitelistRoles = whitelistRoles || template?.whitelistRoles || [];
  const finalMinAccountAge = minAccountAge ?? template?.minAccountAge ?? null;
  const finalMinJoinDate = minJoinDate ?? template?.minJoinDate ?? null;
  const finalBonusRoles = bonusRoles || template?.bonusRoles || [];
  const finalBoosterBonus = boosterBonus ?? template?.boosterBonus ?? 0;
  const finalClaimTimeLimit = claimTimeLimit ?? template?.claimTimeLimit ?? null;
  const finalDmNotify = dmNotify ?? template?.dmNotify ?? true;
  const finalEmbedColor = embedColor || template?.embedColor || null;
  const finalThumbnailUrl = thumbnailUrl || template?.thumbnailUrl || null;
  const finalFooterText = footerText || template?.footerText || null;
  const finalShowParticipants = showParticipants ?? template?.showParticipants ?? true;

  const now = Date.now();
  const startTime = startDelayMs ? new Date(now + startDelayMs) : new Date(now);
  const endTime = new Date(startTime.getTime() + durationMs);

  if (finalEmbedColor && !/^#[0-9A-F]{6}$/i.test(finalEmbedColor)) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid color format. Please use a hex code like `#FFD700`.')] });
  }

  const giveaway = new GiveawayModel({
    giveawayId: `g_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    guildId: interaction.guildId,
    channelId: channel.id,
    messageId: 'pending',
    prize,
    winnerCount: winnersCount,
    hostId: interaction.user.id,
    startTime,
    endTime,
    status: startDelayMs ? 'scheduled' : 'active',
    requiredRoles: finalRequiredRoles,
    blacklistRoles: finalBlacklistRoles,
    whitelistRoles: finalWhitelistRoles,
    minAccountAge: finalMinAccountAge,
    minJoinDate: finalMinJoinDate,
    bonusRoles: finalBonusRoles,
    boosterBonus: finalBoosterBonus,
    claimTimeLimit: finalClaimTimeLimit,
    dmNotify: finalDmNotify,
    showParticipants: finalShowParticipants,
    embedColor: finalEmbedColor,
    imageUrl,
    thumbnailUrl: finalThumbnailUrl,
    footerText: finalFooterText,
    entries: []
  });

  if (startDelayMs) {
    giveaway.messageId = `sched_${Date.now()}`;
    giveaway.giveawayId = giveaway.messageId;
    await giveaway.save();
    
    const startUnix = Math.floor(startTime.getTime() / 1000);
    return interaction.editReply({
      embeds: [successEmbed(`📅 Giveaway scheduled for **${prize}**! It will start at <t:${startUnix}:f> (<t:${startUnix}:R>) in ${channel}.`)]
    });
  }

  try {
    await giveawayManager.startGiveaway(giveaway);
    const link = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${giveaway.messageId}`;
    return interaction.editReply({
      embeds: [successEmbed(`🎉 Giveaway started in ${channel}! [Go to Message](${link})`)]
    });
  } catch (err) {
    logger.error(`Failed to start giveaway: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to start the giveaway. Please verify permissions.')] });
  }
}

async function handleSetup(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('giveaway_setup_modal')
    .setTitle('Quick Giveaway Creation');

  const prizeInput = new TextInputBuilder()
    .setCustomId('setup_prize')
    .setLabel('Prize')
    .setPlaceholder('Enter the prize name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const durationInput = new TextInputBuilder()
    .setCustomId('setup_duration')
    .setLabel('Duration')
    .setPlaceholder('e.g., 2h, 1d, 30m')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const winnersInput = new TextInputBuilder()
    .setCustomId('setup_winners')
    .setLabel('Winner Count')
    .setValue('1')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const channelInput = new TextInputBuilder()
    .setCustomId('setup_channel')
    .setLabel('Channel ID (Optional)')
    .setPlaceholder('Leave blank for this channel')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const templateInput = new TextInputBuilder()
    .setCustomId('setup_template')
    .setLabel('Template Name (Optional)')
    .setPlaceholder('Load configuration preset')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prizeInput),
    new ActionRowBuilder().addComponents(durationInput),
    new ActionRowBuilder().addComponents(winnersInput),
    new ActionRowBuilder().addComponents(channelInput),
    new ActionRowBuilder().addComponents(templateInput)
  );

  await interaction.showModal(modal);
}

async function handleStart(interaction) {
  const prize = interaction.options.getString('prize', true);
  const durationStr = interaction.options.getString('duration', true);
  const winnersCount = interaction.options.getInteger('winners', true);
  const channel = interaction.options.getChannel('channel') || interaction.channel;

  const requiredRoles = parseRoles(interaction.options.getString('required-roles'));
  const blacklistRoles = parseRoles(interaction.options.getString('blacklist-roles'));
  const whitelistRoles = parseRoles(interaction.options.getString('whitelist-roles'));

  const accountAgeStr = interaction.options.getString('min-account-age');
  const minAccountAge = accountAgeStr ? parseDuration(accountAgeStr) : null;

  const joinDateStr = interaction.options.getString('min-join-date');
  const minJoinDate = joinDateStr ? parseDuration(joinDateStr) : null;

  const bonusRolesStr = interaction.options.getString('bonus-roles');
  const bonusRoles = bonusRolesStr ? parseBonusRoles(bonusRolesStr) : null;

  const boosterBonus = interaction.options.getInteger('booster-bonus');
  const claimTimeStr = interaction.options.getString('claim-time');
  const claimTimeLimit = claimTimeStr ? parseDuration(claimTimeStr) : null;

  const dmNotify = interaction.options.getBoolean('dm-notify');
  const showParticipants = interaction.options.getBoolean('show-participants');
  const embedColor = interaction.options.getString('embed-color');
  const imageUrl = interaction.options.getString('image-url');
  const thumbnailUrl = interaction.options.getString('thumbnail-url');
  const footerText = interaction.options.getString('footer-text');

  const startDelayStr = interaction.options.getString('start-delay');
  const startDelayMs = startDelayStr ? parseDuration(startDelayStr) : null;
  const templateName = interaction.options.getString('template');

  await createAndStartGiveaway(interaction, {
    prize,
    durationStr,
    winnersCount,
    channel,
    templateName,
    requiredRoles,
    blacklistRoles,
    whitelistRoles,
    minAccountAge,
    minJoinDate,
    bonusRoles,
    boosterBonus,
    claimTimeLimit,
    dmNotify,
    showParticipants,
    embedColor,
    imageUrl,
    thumbnailUrl,
    footerText,
    startDelayMs
  });
}

async function handleEnd(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);

  const giveaway = await GiveawayModel.findOne({ giveawayId });
  if (!giveaway) {
    return interaction.editReply({ embeds: [errorEmbed(`Giveaway with ID \`${giveawayId}\` not found.`)] });
  }

  if (giveaway.status === 'ended') {
    return interaction.editReply({ embeds: [errorEmbed('This giveaway has already ended.')] });
  }

  try {
    await giveawayManager.endGiveaway(giveawayId, true);
    return interaction.editReply({ embeds: [successEmbed(`Giveaway ended successfully.`)] });
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(`Failed to end giveaway: ${err.message}`)] });
  }
}

async function handleReroll(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);
  const count = interaction.options.getInteger('count') || 1;
  const usersStr = interaction.options.getString('users');

  const usersToReroll = usersStr ? usersStr.split(',').map(s => s.trim().replace(/[<@!>]/g, '')) : null;

  try {
    const newWinners = await giveawayManager.rerollGiveaway(giveawayId, count, usersToReroll);
    const mentions = newWinners.map(w => `<@${w}>`).join(', ');
    return interaction.editReply({
      embeds: [successEmbed(`🏆 Rerolled winner(s)! New winner(s): ${mentions}`)]
    });
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(err.message)] });
  }
}

async function handleEdit(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);
  const prize = interaction.options.getString('prize');
  const durationOption = interaction.options.getString('duration');
  const winners = interaction.options.getInteger('winners');

  const giveaway = await GiveawayModel.findOne({ giveawayId });
  if (!giveaway) {
    return interaction.editReply({ embeds: [errorEmbed(`Giveaway with ID \`${giveawayId}\` not found.`)] });
  }

  if (giveaway.status === 'ended') {
    return interaction.editReply({ embeds: [errorEmbed('You cannot edit an ended giveaway.')] });
  }

  const updates = [];
  if (prize) {
    giveaway.prize = prize;
    updates.push('prize');
  }

  if (winners) {
    giveaway.winnerCount = winners;
    updates.push('winners count');
  }

  if (durationOption) {
    let newEndTime = giveaway.endTime;
    if (durationOption.startsWith('+')) {
      const added = parseDuration(durationOption.slice(1));
      if (!added) return interaction.editReply({ embeds: [errorEmbed('Invalid added duration format.')] });
      newEndTime = new Date(giveaway.endTime.getTime() + added);
    } else if (durationOption.startsWith('-')) {
      const subtracted = parseDuration(durationOption.slice(1));
      if (!subtracted) return interaction.editReply({ embeds: [errorEmbed('Invalid subtracted duration format.')] });
      newEndTime = new Date(giveaway.endTime.getTime() - subtracted);
    } else {
      const duration = parseDuration(durationOption);
      if (!duration) return interaction.editReply({ embeds: [errorEmbed('Invalid duration format.')] });
      const base = giveaway.pausedAt || new Date();
      newEndTime = new Date(base.getTime() + duration);
    }

    if (newEndTime.getTime() <= Date.now()) {
      return interaction.editReply({ embeds: [errorEmbed('The edited duration would cause the giveaway to end in the past.')] });
    }

    giveaway.endTime = newEndTime;
    updates.push('duration');
  }

  if (updates.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed('Please specify at least one option to edit.')] });
  }

  await giveaway.save();
  await giveawayManager.updateGiveawayMessage(giveaway);

  return interaction.editReply({
    embeds: [successEmbed(`Successfully updated giveaway ${updates.join(', ')}.`)]
  });
}

async function handleList(interaction) {
  const active = await GiveawayModel.find({ guildId: interaction.guildId, status: { $in: ['active', 'paused'] } }).sort({ createdAt: -1 });
  if (active.length === 0) {
    return interaction.editReply({
      embeds: [simpleEmbed({ color: 0x5865F2, title: 'Active Giveaways', description: 'There are no active or paused giveaways in this server.' })]
    });
  }

  const activeGiveaways = [];
  const deadGiveawayIds = [];

  for (const g of active) {
    const channel = interaction.guild.channels.cache.get(g.channelId);
    if (!channel) {
      deadGiveawayIds.push(g.giveawayId);
      continue;
    }
    const msg = await channel.messages.fetch(g.messageId).catch(() => null);
    if (!msg) {
      deadGiveawayIds.push(g.giveawayId);
      continue;
    }
    activeGiveaways.push(g);
  }

  if (deadGiveawayIds.length > 0) {
    await GiveawayModel.deleteMany({ giveawayId: { $in: deadGiveawayIds } });
  }

  if (activeGiveaways.length === 0) {
    return interaction.editReply({
      embeds: [simpleEmbed({ color: 0x5865F2, title: 'Active Giveaways', description: 'There are no active or paused giveaways in this server.' })]
    });
  }

  const desc = activeGiveaways.map(g => {
    const timeUnix = Math.floor(g.endTime.getTime() / 1000);
    const link = `https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}`;
    return `• **[${g.prize}](${link})** (ID: \`${g.giveawayId}\`) | Winners: ${g.winnerCount} | Ends: <t:${timeUnix}:R> (${g.status.toUpperCase()})`;
  }).join('\n');

  return interaction.editReply({
    embeds: [simpleEmbed({ color: 0x5865F2, title: `Active Giveaways (${activeGiveaways.length})`, description: desc })]
  });
}

async function handleDelete(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);

  try {
    await giveawayManager.deleteGiveaway(giveawayId);
    return interaction.editReply({ embeds: [successEmbed('Giveaway deleted and message removed successfully.')] });
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(err.message)] });
  }
}

async function handlePause(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);

  try {
    await giveawayManager.pauseGiveaway(giveawayId);
    return interaction.editReply({ embeds: [successEmbed('Giveaway has been paused.')] });
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(err.message)] });
  }
}

async function handleResume(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id', true);

  try {
    await giveawayManager.resumeGiveaway(giveawayId);
    return interaction.editReply({ embeds: [successEmbed('Giveaway has been resumed.')] });
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed(err.message)] });
  }
}

async function handleStats(interaction) {
  const giveawayId = interaction.options.getString('giveaway-id');
  const targetUser = interaction.options.getUser('user');

  if (!giveawayId && !targetUser) {
    return interaction.editReply({ embeds: [errorEmbed('Please specify either a giveaway ID or a user.')] });
  }

  if (giveawayId) {
    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway) {
      return interaction.editReply({ embeds: [errorEmbed(`Giveaway with ID \`${giveawayId}\` not found.`)] });
    }

    const durationUnix = Math.floor(giveaway.endTime.getTime() / 1000);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`Stats for Giveaway: ${giveaway.prize}`)
      .addFields(
        { name: 'Status', value: giveaway.status.toUpperCase(), inline: true },
        { name: 'Entries', value: String(giveaway.entries.length), inline: true },
        { name: 'Winners Count', value: String(giveaway.winnerCount), inline: true },
        { name: 'End Time', value: `<t:${durationUnix}:f>`, inline: false }
      );

    if (giveaway.status === 'ended') {
      embed.addFields(
        { name: 'Winners', value: giveaway.winners.map(w => `<@${w}>`).join(', ') || 'None', inline: true },
        { name: 'Claimed', value: giveaway.claimed.map(c => `<@${c}>`).join(', ') || 'None', inline: true }
      );
    }

    return interaction.editReply({ embeds: [embed] });
  }

  const userId = targetUser.id;
  const totalEntered = await GiveawayModel.countDocuments({ guildId: interaction.guildId, 'entries.userId': userId });
  const totalWon = await GiveawayModel.countDocuments({ guildId: interaction.guildId, winners: userId });
  const totalClaimed = await GiveawayModel.countDocuments({ guildId: interaction.guildId, claimed: userId });

  const history = await GiveawayModel.find({ guildId: interaction.guildId, winners: userId }).limit(5).lean();
  const historyList = history.map(g => `• **${g.prize}** (${new Date(g.endTime).toLocaleDateString()})`).join('\n') || 'No wins recorded';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Giveaway Stats | ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: 'Giveaways Entered', value: String(totalEntered), inline: true },
      { name: 'Giveaways Won', value: String(totalWon), inline: true },
      { name: 'Prizes Claimed', value: String(totalClaimed), inline: true },
      { name: 'Recent Wins (Guild)', value: historyList, inline: false }
    );

  return interaction.editReply({ embeds: [embed] });
}

// Template handlers
async function handleTemplateSave(interaction) {
  const name = interaction.options.getString('name', true);
  
  const requiredRoles = parseRoles(interaction.options.getString('required-roles'));
  const blacklistRoles = parseRoles(interaction.options.getString('blacklist-roles'));
  const whitelistRoles = parseRoles(interaction.options.getString('whitelist-roles'));

  const accountAgeStr = interaction.options.getString('min-account-age');
  const minAccountAge = accountAgeStr ? parseDuration(accountAgeStr) : null;

  const joinDateStr = interaction.options.getString('min-join-date');
  const minJoinDate = joinDateStr ? parseDuration(joinDateStr) : null;

  const bonusRolesStr = interaction.options.getString('bonus-roles');
  const bonusRoles = bonusRolesStr ? parseBonusRoles(bonusRolesStr) : [];

  const boosterBonus = interaction.options.getInteger('booster-bonus') || 0;
  const claimTimeStr = interaction.options.getString('claim-time');
  const claimTimeLimit = claimTimeStr ? parseDuration(claimTimeStr) : null;

  const embedColor = interaction.options.getString('embed-color');
  const thumbnailUrl = interaction.options.getString('thumbnail-url');
  const footerText = interaction.options.getString('footer-text');
  const dmNotify = interaction.options.getBoolean('dm-notify') ?? true;
  const showParticipants = interaction.options.getBoolean('show-participants') ?? true;

  if (embedColor && !/^#[0-9A-F]{6}$/i.test(embedColor)) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid color format. Please use a hex code like `#FFD700`.')] });
  }

  await GiveawayTemplateModel.findOneAndUpdate(
    { guildId: interaction.guildId, name },
    {
      $set: {
        requiredRoles,
        blacklistRoles,
        whitelistRoles,
        minAccountAge,
        minJoinDate,
        bonusRoles,
        boosterBonus,
        claimTimeLimit,
        embedColor,
        thumbnailUrl,
        footerText,
        dmNotify,
        showParticipants
      }
    },
    { upsert: true, new: true }
  );

  return interaction.editReply({ embeds: [successEmbed(`Template \`${name}\` has been saved successfully.`)] });
}

async function handleTemplateDelete(interaction) {
  const name = interaction.options.getString('name', true);

  const deleted = await GiveawayTemplateModel.findOneAndDelete({ guildId: interaction.guildId, name });
  if (!deleted) {
    return interaction.editReply({ embeds: [errorEmbed(`Template \`${name}\` not found.`)] });
  }

  return interaction.editReply({ embeds: [successEmbed(`Template \`${name}\` deleted successfully.`)] });
}

async function handleTemplateList(interaction) {
  const templates = await GiveawayTemplateModel.find({ guildId: interaction.guildId });
  if (templates.length === 0) {
    return interaction.editReply({
      embeds: [simpleEmbed({ color: 0x5865F2, title: 'Giveaway Templates', description: 'No templates configured in this server. Use `/giveaway template save` to create one.' })]
    });
  }

  const desc = templates.map(t => {
    const details = [];
    if (t.requiredRoles?.length > 0) details.push(`Req Roles: ${t.requiredRoles.length}`);
    if (t.claimTimeLimit) details.push(`Claim: ${Math.round(t.claimTimeLimit / 60000)}m`);
    if (t.boosterBonus) details.push(`Booster: +${t.boosterBonus}`);
    
    return `• **\`${t.name}\`** ${details.length > 0 ? `(${details.join(', ')})` : ''}`;
  }).join('\n');

  return interaction.editReply({
    embeds: [simpleEmbed({ color: 0x5865F2, title: `Giveaway Templates (${templates.length})`, description: desc })]
  });
}
