import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { WelcomeSettingsModel } from '../../models/WelcomeSettings.js';
import { createWelcomeCard } from '../../utils/welcomeCard.js';
import { config } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Configure the welcome system')
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Configure welcome channel and auto-role')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Channel to post welcome messages in')
          .setRequired(true)
      )
      .addRoleOption(opt =>
        opt.setName('role')
          .setDescription('Role to auto-assign to new members')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('toggle')
      .setDescription('Enable or disable the welcome system')
      .addBooleanOption(opt =>
        opt.setName('enabled')
          .setDescription('Enable or disable')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('message')
      .setDescription('Set a custom welcome message template')
      .addStringOption(opt =>
        opt.setName('template')
          .setDescription('Use {user}, {username}, {server}, {membercount}, {rules} as placeholders')
          .setRequired(true)
          .setMaxLength(1000)
      )
  )
  .addSubcommand(sub =>
    sub.setName('image')
      .setDescription('Upload or set a custom welcome template image URL')
      .addAttachmentOption(opt =>
        opt.setName('file')
          .setDescription('Upload a custom welcome image template')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('Direct link to custom welcome image template')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('preview')
      .setDescription('Preview the current welcome message and card setup')
  );

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return sendResponse(interaction, { embeds: [errorEmbed('You need Manage Guild permission.')] });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('role');

    if (!channel.isTextBased() || channel.isThread()) {
      return sendResponse(interaction, { embeds: [errorEmbed('Please select a text-based channel.')] });
    }

    if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return sendResponse(interaction, { embeds: [errorEmbed('I need View Channel, Send Messages, and Embed Links permissions in that channel.')] });
    }

    const update = { channelId: channel.id };
    if (role) update.roleId = role.id;

    await WelcomeSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: update, $setOnInsert: { guildId: interaction.guildId } },
      { upsert: true }
    );

    const roleMsg = role ? ` with auto-role **${role.name}**` : '';
    return sendResponse(interaction, { embeds: [successEmbed(`Welcome channel set to **${channel.name}**${roleMsg}. Use \`/welcome toggle\` to enable the system.`)] });
  }

  if (sub === 'toggle') {
    const enabled = interaction.options.getBoolean('enabled', true);

    const settings = await WelcomeSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { enabled }, $setOnInsert: { guildId: interaction.guildId } },
      { upsert: true, new: true }
    );

    if (enabled && !settings.channelId) {
      return sendResponse(interaction, { embeds: [errorEmbed('Please run `/welcome setup` first to configure a channel.')] });
    }

    return sendResponse(interaction, { embeds: [successEmbed(`Welcome system ${enabled ? 'enabled' : 'disabled'}.`)] });
  }

  if (sub === 'message') {
    const template = interaction.options.getString('template', true);

    await WelcomeSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { messageTemplate: template }, $setOnInsert: { guildId: interaction.guildId } },
      { upsert: true }
    );

    return sendResponse(interaction, { embeds: [successEmbed('Welcome message template updated successfully.')] });
  }

  if (sub === 'image') {
    const file = interaction.options.getAttachment('file');
    const url = interaction.options.getString('url');

    const imageUrl = file ? file.url : url;
    if (!imageUrl) {
      return sendResponse(interaction, { embeds: [errorEmbed('Please provide either an image attachment file or an image URL.')] });
    }

    await WelcomeSettingsModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { welcomeImageUrl: imageUrl }, $setOnInsert: { guildId: interaction.guildId } },
      { upsert: true }
    );

    return sendResponse(interaction, { embeds: [successEmbed(`Welcome template image updated successfully.`)] });
  }

  if (sub === 'preview') {
    const welcomeSettings = await WelcomeSettingsModel.findOne({ guildId: interaction.guildId });

    const statusInfo = [];
    if (!welcomeSettings?.enabled) statusInfo.push('⚠️ Welcome system is currently disabled (use `/welcome toggle true` to enable).');
    if (!welcomeSettings?.channelId) statusInfo.push('⚠️ Welcome channel is not set (use `/welcome setup` to configure).');

    const memberCount = interaction.guild.memberCount;
    const rulesChannel = interaction.guild.channels.cache.find(c => c.name && c.name.toLowerCase().includes('rules'));
    const rulesMention = rulesChannel ? `${rulesChannel}` : '#rules';

    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
    let cardBuffer;
    try {
      cardBuffer = await createWelcomeCard(interaction.user.username, memberCount, avatarUrl);
    } catch (err) {
      return sendResponse(interaction, { embeds: [errorEmbed(`Failed to generate welcome card preview: ${err.message}`)] });
    }

    const filename = `welcome-${Date.now()}.png`;
    const attachment = new AttachmentBuilder(cardBuffer, { name: filename });

    const rawTemplate = welcomeSettings?.messageTemplate || config.welcomeTemplate;
    const formattedMessage = rawTemplate
      .replace(/{user}/g, `${interaction.user}`)
      .replace(/{username}/g, interaction.user.username)
      .replace(/{server}/g, interaction.guild.name)
      .replace(/{membercount}/g, memberCount.toString())
      .replace(/{rules}/g, rulesMention);

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`Welcome ${interaction.user.username} to ${interaction.guild.name}!`)
      .setDescription(formattedMessage)
      .setImage(`attachment://${filename}`);

    const customImg = welcomeSettings?.welcomeImageUrl || config.welcomeImageUrl;
    if (customImg) {
      embed.setThumbnail(customImg);
    }

    if (statusInfo.length > 0) {
      embed.setFooter({ text: statusInfo.join('\n') });
    }

    return sendResponse(interaction, { embeds: [embed], files: [attachment] });
  }
}

async function sendResponse(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    } else {
      return await interaction.reply({ ...options, ephemeral: true });
    }
  } catch (err) {
    try {
      return await interaction.followUp({ ...options, ephemeral: true });
    } catch { }
  }
}
