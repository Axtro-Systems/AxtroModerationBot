import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

// Must match MAX_WINDOW in tracker (5 min) — interval cannot exceed this
const MAX_TRACKER_WINDOW = 300000;

export const data = new SlashCommandBuilder()
  .setName('antinuke-config')
  .setDescription('Configure anti-nuke thresholds and behaviour')
  .addIntegerOption(opt => opt.setName('max_bans').setDescription('Max bans allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_kicks').setDescription('Max kicks allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_channel_creates').setDescription('Max channel creates allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_channel_deletes').setDescription('Max channel deletes allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_role_deletes').setDescription('Max role deletes allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_role_creates').setDescription('Max role creates allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_webhooks').setDescription('Max webhooks created in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_guild_updates').setDescription('Max server changes (name/icon) allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_emoji_creates').setDescription('Max emoji creates allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('max_sticker_creates').setDescription('Max sticker creates allowed in the interval').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('interval').setDescription('Time window in ms (max 300000 / 5min)').setMinValue(5000).setMaxValue(MAX_TRACKER_WINDOW))
  // --- Layered channel create/delete thresholds ---
  .addIntegerOption(opt => opt.setName('burst_channel_deletes').setDescription('Channel deletes in 10s to trigger burst detection').setMinValue(1).setMaxValue(20))
  .addIntegerOption(opt => opt.setName('burst_channel_creates').setDescription('Channel creates in 10s to trigger burst detection').setMinValue(1).setMaxValue(30))
  .addIntegerOption(opt => opt.setName('sustained_channel_deletes').setDescription('Channel deletes in 5min to trigger sustained detection').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('sustained_channel_creates').setDescription('Channel creates in 5min to trigger sustained detection').setMinValue(1).setMaxValue(50))
  .addIntegerOption(opt => opt.setName('setup_mode_multiplier').setDescription('Multiplier applied to all thresholds while Setup Mode is active').setMinValue(1).setMaxValue(10))
  // --- Punishment & AutoRestore ---
  .addStringOption(opt => opt.setName('action').setDescription('Action to take when threshold is exceeded').addChoices(
    { name: 'Ban', value: 'ban' },
    { name: 'Kick', value: 'kick' },
    { name: 'Strip Roles', value: 'strip' },
  ))
  .addBooleanOption(opt => opt.setName('auto_restore').setDescription('Automatically restore deleted channels/roles'));

export const cooldown = 10000;

// Maps option name -> [DB path, human label]
const OPTION_MAP = {
  max_bans: ['antiNuke.maxBans', 'Max Bans'],
  max_kicks: ['antiNuke.maxKicks', 'Max Kicks'],
  max_channel_creates: ['antiNuke.maxChannelCreates', 'Max Channel Creates'],
  max_channel_deletes: ['antiNuke.maxChannelDeletes', 'Max Channel Deletes'],
  max_role_deletes: ['antiNuke.maxRoleDeletes', 'Max Role Deletes'],
  max_role_creates: ['antiNuke.maxRoleCreates', 'Max Role Creates'],
  max_webhooks: ['antiNuke.maxWebhooks', 'Max Webhooks'],
  max_guild_updates: ['antiNuke.maxGuildUpdates', 'Max Guild Updates'],
  max_emoji_creates: ['antiNuke.maxEmojiCreates', 'Max Emoji Creates'],
  max_sticker_creates: ['antiNuke.maxStickerCreates', 'Max Sticker Creates'],
  interval: ['antiNuke.interval', 'Interval (ms)'],
  burst_channel_deletes: ['antiNuke.burstChannelDeletes', 'Burst Channel Deletes (10s)'],
  burst_channel_creates: ['antiNuke.burstChannelCreates', 'Burst Channel Creates (10s)'],
  sustained_channel_deletes: ['antiNuke.sustainedChannelDeletes', 'Sustained Channel Deletes (5m)'],
  sustained_channel_creates: ['antiNuke.sustainedChannelCreates', 'Sustained Channel Creates (5m)'],
  setup_mode_multiplier: ['antiNuke.setupModeMultiplier', 'Setup Mode Multiplier'],
  action: ['antiNuke.action', 'Punishment Action'],
  auto_restore: ['antiNuke.autoRestore', 'Auto Restore'],
};

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to use this command.')] });
  }

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId }).lean();
  if (!guildConfig) {
    return interaction.editReply({ embeds: [errorEmbed('Guild configuration not found.')] });
  }

  // 1. Cross-Field Sanity Validation (Burst vs Sustained)
  const burstDel = interaction.options.getInteger('burst_channel_deletes');
  const sustainedDel = interaction.options.getInteger('sustained_channel_deletes');
  const currentBurstDel = guildConfig.antiNuke?.burstChannelDeletes ?? 3;
  const currentSustainedDel = guildConfig.antiNuke?.sustainedChannelDeletes ?? 10;
  const finalBurstDel = burstDel !== null ? burstDel : currentBurstDel;
  const finalSustainedDel = sustainedDel !== null ? sustainedDel : currentSustainedDel;

  if (finalBurstDel > finalSustainedDel) {
    return interaction.editReply({
      embeds: [errorEmbed(`Burst channel deletes (${finalBurstDel}) cannot be higher than sustained channel deletes (${finalSustainedDel}).`)]
    });
  }

  const burstCreate = interaction.options.getInteger('burst_channel_creates');
  const sustainedCreate = interaction.options.getInteger('sustained_channel_creates');
  const currentBurstCreate = guildConfig.antiNuke?.burstChannelCreates ?? 5;
  const currentSustainedCreate = guildConfig.antiNuke?.sustainedChannelCreates ?? 15;
  const finalBurstCreate = burstCreate !== null ? burstCreate : currentBurstCreate;
  const finalSustainedCreate = sustainedCreate !== null ? sustainedCreate : currentSustainedCreate;

  if (finalBurstCreate > finalSustainedCreate) {
    return interaction.editReply({
      embeds: [errorEmbed(`Burst channel creates (${finalBurstCreate}) cannot be higher than sustained channel creates (${finalSustainedCreate}).`)]
    });
  }

  // 2. Extract options & filter no-ops
  const updates = {};
  const changeLog = []; // [{ label, oldVal, newVal }]

  const getExisting = (path) => path.split('.').reduce((obj, key) => obj?.[key], guildConfig);

  for (const [optionName, [dbPath, label]] of Object.entries(OPTION_MAP)) {
    let value;
    if (optionName === 'action') {
      value = interaction.options.getString(optionName);
    } else if (optionName === 'auto_restore') {
      value = interaction.options.getBoolean(optionName);
    } else {
      value = interaction.options.getInteger(optionName);
    }

    if (value === null || value === undefined) continue;

    const oldVal = getExisting(dbPath);
    // Ignore no-op updates where new value matches existing value
    if (oldVal === value) continue;

    updates[dbPath] = value;
    changeLog.push({ label, oldVal: oldVal ?? '—', newVal: value });
  }

  if (Object.keys(updates).length === 0) {
    return interaction.editReply({ embeds: [errorEmbed('No configuration changes were made (options match current values).')] });
  }

  await GuildModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: updates }
  );

  client.eventHandler?.invalidateGuildConfig(interaction.guildId);

  try {
    await logAudit({
      guildId: interaction.guildId,
      action: 'antinuke_config_update',
      moderatorId: interaction.user.id,
      details: `Updated: ${Object.keys(updates).join(', ')}`,
    });
  } catch (err) {
    // Audit logging failure shouldn't block config update
  }

  // 3. Build field-based diff confirmation embed (prevents 4096 char description overflow)
  const confirmEmbed = new EmbedBuilder()
    .setTitle('✅ Anti-Nuke Configuration Updated')
    .setColor(0x5865f2)
    .setFooter({ text: `Updated by ${interaction.user.tag}` })
    .setTimestamp();

  for (const c of changeLog) {
    confirmEmbed.addFields({
      name: c.label,
      value: `\`${c.oldVal}\` → \`${c.newVal}\``,
      inline: true
    });
  }

  await interaction.editReply({ embeds: [confirmEmbed] });
}
