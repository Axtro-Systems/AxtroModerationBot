import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { successEmbed, errorEmbed, simpleEmbed, getLogoUrl } from '../../utils/embed.js';
import { TicketSettingsModel } from '../../models/TicketSettings.js';

const setupState = new Map();

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Configure and manage the ticket system')
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Walk through ticket system configuration')
  )
  .addSubcommandGroup(group =>
    group.setName('panel')
      .setDescription('Manage ticket panels')
      .addSubcommand(sub =>
        sub.setName('create')
          .setDescription('Create a new ticket panel')
          .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the panel').setRequired(true))
          .addStringOption(opt => opt.setName('title').setDescription('Panel embed title'))
          .addStringOption(opt => opt.setName('description').setDescription('Panel embed description'))
      )
      .addSubcommand(sub =>
        sub.setName('edit')
          .setDescription('Edit a ticket panel')
          .addStringOption(opt => opt.setName('panel-id').setDescription('Panel ID').setRequired(true))
          .addStringOption(opt => opt.setName('title').setDescription('New panel title'))
          .addStringOption(opt => opt.setName('description').setDescription('New panel description'))
      )
      .addSubcommand(sub =>
        sub.setName('list')
          .setDescription('List all ticket panels')
      )
      .addSubcommand(sub =>
        sub.setName('delete')
          .setDescription('Delete a ticket panel')
          .addStringOption(opt => opt.setName('panel-id').setDescription('Panel ID').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('post')
          .setDescription('Post or re-post a ticket panel')
          .addStringOption(opt => opt.setName('panel-id').setDescription('Panel ID').setRequired(true))
          .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post in (defaults to original)'))
      )
  );

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Guild permission.')] });
  }

  const subGroup = interaction.options.getSubcommandGroup(false);

  if (subGroup === 'panel') {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'create': return panelCreate(interaction, client);
      case 'edit': return panelEdit(interaction, client);
      case 'list': return panelList(interaction, client);
      case 'delete': return panelDelete(interaction, client);
      case 'post': return panelPost(interaction, client);
    }
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'setup') return startSetup(interaction, client);
}

async function startSetup(interaction, client) {
  const embed = simpleEmbed({
    color: 0x5865F2,
    title: 'Ticket System Setup',
    description: 'Let\'s configure the ticket system. First, select the **category** where ticket channels will be created.\n\nClick the menu below to choose a category.',
  });

  const select = new ChannelSelectMenuBuilder()
    .setCustomId('ticket_setup_category')
    .setPlaceholder('Select a category')
    .setChannelTypes(4);

  setupState.set(interaction.user.id, { guildId: interaction.guildId, step: 'category' });
  setTimeout(() => setupState.delete(interaction.user.id), 300000);

  return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

async function panelCreate(interaction, client) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) {
    return interaction.editReply({ embeds: [errorEmbed('Please select a text channel.')] });
  }

  const title = interaction.options.getString('title') || '🎫 Open a Ticket';
  const description = interaction.options.getString('description') || 'Click the button below to open a ticket.';

  let settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings) {
    settings = await TicketSettingsModel.create({ guildId: interaction.guildId });
  }

  const panelId = `panel_${Date.now().toString(36).slice(-5)}`;

  const embed = simpleEmbed({ color: 0x5865F2, title, description, footer: { text: 'Axtro Systems' } })
    .setThumbnail(getLogoUrl());

  const openButton = new ButtonBuilder()
    .setCustomId(`ticket_open_${panelId}`)
    .setLabel('🎫 Open a Ticket')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(openButton);
  const msg = await channel.send({ embeds: [embed], components: [row] });

  await TicketSettingsModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $push: { panels: { id: panelId, title, description, channelId: channel.id, messageId: msg.id } } }
  );

  return interaction.editReply({ embeds: [successEmbed(`Panel \`${panelId}\` created and posted in ${channel}.`)] });
}

async function panelEdit(interaction, client) {
  const panelId = interaction.options.getString('panel-id', true);
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');

  if (!title && !description) {
    return interaction.editReply({ embeds: [errorEmbed('Provide at least a title or description to update.')] });
  }

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings) {
    return interaction.editReply({ embeds: [errorEmbed('No ticket settings found. Run `/ticket setup` first.')] });
  }

  const panel = settings.panels?.find(p => p.id === panelId);
  if (!panel) {
    return interaction.editReply({ embeds: [errorEmbed(`Panel \`${panelId}\` not found.`)] });
  }

  const update = {};
  if (title) update['panels.$.title'] = title;
  if (description) update['panels.$.description'] = description;

  if (title) panel.title = title;
  if (description) panel.description = description;

  await TicketSettingsModel.findOneAndUpdate(
    { guildId: interaction.guildId, 'panels.id': panelId },
    { $set: update }
  );

  if (panel.channelId && panel.messageId) {
    try {
      const channel = interaction.guild.channels.cache.get(panel.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (msg) {
          const embed = simpleEmbed({ color: 0x5865F2, title: panel.title, description: panel.description, footer: { text: 'Axtro Systems' } })
            .setThumbnail(getLogoUrl());
          await msg.edit({ embeds: [embed] });
        }
      }
    } catch {}
  }

  return interaction.editReply({ embeds: [successEmbed(`Panel \`${panelId}\` updated.`)] });
}

async function panelList(interaction, client) {
  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings || !settings.panels?.length) {
    return interaction.editReply({ embeds: [simpleEmbed({ color: 0x5865F2, title: 'Ticket Panels', description: 'No panels configured. Use `/ticket panel create` to add one.' })] });
  }

  const activePanels = [];
  const deadPanelIds = [];

  for (const p of settings.panels) {
    const channel = interaction.guild.channels.cache.get(p.channelId);
    if (!channel) {
      deadPanelIds.push(p.id);
      continue;
    }
    const msg = await channel.messages.fetch(p.messageId).catch(() => null);
    if (!msg) {
      deadPanelIds.push(p.id);
      continue;
    }
    activePanels.push(p);
  }

  if (deadPanelIds.length > 0) {
    await TicketSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $pull: { panels: { id: { $in: deadPanelIds } } } }
    );
  }

  if (activePanels.length === 0) {
    return interaction.editReply({ embeds: [simpleEmbed({ color: 0x5865F2, title: 'Ticket Panels', description: 'No panels configured. Use `/ticket panel create` to add one.' })] });
  }

  const desc = activePanels.map(p => {
    const location = p.channelId ? `<#${p.channelId}>` : 'Not set';
    return `**\`${p.id}\`** — ${p.title}\n> ${p.description || 'No description'}\n> Location: ${location}`;
  }).join('\n\n');

  return interaction.editReply({ embeds: [simpleEmbed({ color: 0x5865F2, title: `Ticket Panels (${activePanels.length})`, description: desc })] });
}

async function panelDelete(interaction, client) {
  const panelId = interaction.options.getString('panel-id', true);

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings || !settings.panels?.find(p => p.id === panelId)) {
    return interaction.editReply({ embeds: [errorEmbed(`Panel \`${panelId}\` not found.`)] });
  }

  await TicketSettingsModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $pull: { panels: { id: panelId } } }
  );

  return interaction.editReply({ embeds: [successEmbed(`Panel \`${panelId}\` deleted.`)] });
}

async function panelPost(interaction, client) {
  const panelId = interaction.options.getString('panel-id', true);
  const channelOpt = interaction.options.getChannel('channel');

  const settings = await TicketSettingsModel.findOne({ guildId: interaction.guildId });
  if (!settings) {
    return interaction.editReply({ embeds: [errorEmbed('No ticket settings found. Run `/ticket setup` first.')] });
  }

  const panel = settings.panels?.find(p => p.id === panelId);
  if (!panel) {
    return interaction.editReply({ embeds: [errorEmbed(`Panel \`${panelId}\` not found.`)] });
  }

  const channel = channelOpt || (panel.channelId ? interaction.guild.channels.cache.get(panel.channelId) : null);
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid channel for panel.')] });
  }

  const embed = simpleEmbed({ color: 0x5865F2, title: panel.title, description: panel.description, footer: { text: 'Axtro Systems' } })
    .setThumbnail(getLogoUrl());

  const openButton = new ButtonBuilder()
    .setCustomId(`ticket_open_${panelId}`)
    .setLabel('🎫 Open a Ticket')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(openButton);
  const msg = await channel.send({ embeds: [embed], components: [row] });

  await TicketSettingsModel.findOneAndUpdate(
    { guildId: interaction.guildId, 'panels.id': panelId },
    { $set: { 'panels.$.channelId': channel.id, 'panels.$.messageId': msg.id } }
  );

  return interaction.editReply({ embeds: [successEmbed(`Panel \`${panelId}\` posted in ${channel}.`)] });
}

export { setupState };
