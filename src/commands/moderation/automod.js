import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Configure automatic message moderation')
  .addSubcommand(sub => sub
    .setName('enable')
    .setDescription('Enable automod for this server'))
  .addSubcommand(sub => sub
    .setName('disable')
    .setDescription('Disable automod for this server'))
  .addSubcommand(sub => sub
    .setName('status')
    .setDescription('Show current automod settings'))
  .addSubcommand(sub => sub
    .setName('config')
    .setDescription('Update automod thresholds and filters')
    .addBooleanOption(opt => opt.setName('filter_links').setDescription('Block external links'))
    .addBooleanOption(opt => opt.setName('filter_invites').setDescription('Block Discord invite links'))
    .addBooleanOption(opt => opt.setName('filter_profanity').setDescription('Block messages containing profanity (manage words with /profanity)'))
    .addIntegerOption(opt => opt.setName('max_mentions').setDescription('Max mentions per message').setMinValue(1).setMaxValue(50))
    .addIntegerOption(opt => opt.setName('max_emojis').setDescription('Max emojis per message').setMinValue(1).setMaxValue(100))
    .addIntegerOption(opt => opt.setName('caps_percent').setDescription('Max caps percentage (5+ letters)').setMinValue(50).setMaxValue(100))
    .addIntegerOption(opt => opt.setName('spam_threshold').setDescription('Messages before spam timeout').setMinValue(3).setMaxValue(20))
    .addIntegerOption(opt => opt.setName('spam_interval').setDescription('Spam window in milliseconds').setMinValue(3000).setMaxValue(60000))
    .addIntegerOption(opt => opt.setName('punishment_cooldown').setDescription('Cooldown between auto-punishments (ms)').setMinValue(5000).setMaxValue(600000))
    .addStringOption(opt => opt.setName('link_allowlist').setDescription('Comma-separated allowed domains (e.g. youtube.com,twitch.tv)')));

export const cooldown = 3000;

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Server permission to configure automod.')] });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'enable') {
    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { 'automod.enabled': true } },
      { upsert: true }
    );
    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({ guildId: interaction.guildId, action: 'automod_enable', moderatorId: interaction.user.id });
    return interaction.editReply({ embeds: [successEmbed('Automod has been **enabled**. Use `/automod config` to adjust filters.')] });
  }

  if (subcommand === 'disable') {
    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { 'automod.enabled': false } },
      { upsert: true }
    );
    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({ guildId: interaction.guildId, action: 'automod_disable', moderatorId: interaction.user.id });
    return interaction.editReply({ embeds: [successEmbed('Automod has been **disabled**.')] });
  }

  if (subcommand === 'status') {
    const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId }).lean();
    const automod = guildConfig?.automod || {};

    const embed = new EmbedBuilder()
      .setColor(automod.enabled ? 0x00FF7F : 0xFF0000)
      .setTitle('Automod Status')
      .addFields(
        { name: 'Status', value: automod.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Filter Links', value: automod.filterLinks ? 'Yes' : 'No', inline: true },
        { name: 'Filter Invites', value: automod.filterInvites ? 'Yes' : 'No', inline: true },
        { name: 'Filter Profanity', value: automod.filterProfanity ? 'Yes' : 'No', inline: true },
        { name: 'Profanity List', value: automod.profanityList?.length ? `${automod.profanityList.length} custom word(s)` : 'Default list', inline: true },
        { name: 'Max Mentions', value: automod.maxMentions ? String(automod.maxMentions) : 'Off', inline: true },
        { name: 'Max Emojis', value: automod.maxEmojis ? String(automod.maxEmojis) : 'Off', inline: true },
        { name: 'Caps Limit', value: automod.capsPercent ? `${automod.capsPercent}%` : 'Off', inline: true },
        { name: 'Spam Threshold', value: automod.spamThreshold ? String(automod.spamThreshold) : 'Off', inline: true },
        { name: 'Spam Interval', value: automod.spamInterval ? `${automod.spamInterval} ms` : 'Off', inline: true },
        { name: 'Punishment Cooldown', value: automod.punishmentCooldown ? `${automod.punishmentCooldown} ms` : 'Default (30s)', inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'config') {
    const updates = {};
    const filterLinks = interaction.options.getBoolean('filter_links');
    const filterInvites = interaction.options.getBoolean('filter_invites');
    const filterProfanity = interaction.options.getBoolean('filter_profanity');
    const maxMentions = interaction.options.getInteger('max_mentions');
    const maxEmojis = interaction.options.getInteger('max_emojis');
    const capsPercent = interaction.options.getInteger('caps_percent');
    const spamThreshold = interaction.options.getInteger('spam_threshold');
    const spamInterval = interaction.options.getInteger('spam_interval');
    const punishmentCooldown = interaction.options.getInteger('punishment_cooldown');
    const linkAllowlistRaw = interaction.options.getString('link_allowlist');

    if (filterLinks !== null) updates['automod.filterLinks'] = filterLinks;
    if (filterInvites !== null) updates['automod.filterInvites'] = filterInvites;
    if (filterProfanity !== null) updates['automod.filterProfanity'] = filterProfanity;
    if (maxMentions !== null) updates['automod.maxMentions'] = maxMentions;
    if (maxEmojis !== null) updates['automod.maxEmojis'] = maxEmojis;
    if (capsPercent !== null) updates['automod.capsPercent'] = capsPercent;
    if (spamThreshold !== null) updates['automod.spamThreshold'] = spamThreshold;
    if (spamInterval !== null) updates['automod.spamInterval'] = spamInterval;
    if (punishmentCooldown !== null) updates['automod.punishmentCooldown'] = punishmentCooldown;
    if (linkAllowlistRaw !== null) updates['automod.linkAllowlist'] = linkAllowlistRaw.split(',').map(s => s.trim()).filter(Boolean);

    if (Object.keys(updates).length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('Provide at least one setting to update.')] });
    }

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: updates },
      { upsert: true }
    );
    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'automod_config_update',
      moderatorId: interaction.user.id,
      details: `Updated: ${Object.keys(updates).join(', ')}`,
    });
    return interaction.editReply({ embeds: [successEmbed('Automod settings updated. Use `/automod status` to review them.')] });
  }
}
