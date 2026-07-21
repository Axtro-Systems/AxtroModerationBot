import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, closeActiveCases, logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { withConcurrencyLimit } from '../../utils/concurrency.js';
import { GuildModel } from '../../models/Guild.js';

export const data = new SlashCommandBuilder()
  .setName('raid')
  .setDescription('Manage raid mode')
  .addSubcommand(sub => sub
    .setName('enable')
    .setDescription('Enable raid mode - lock server and kick new members')
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for enabling raid mode')))
  .addSubcommand(sub => sub
    .setName('disable')
    .setDescription('Disable raid mode - restore server settings')
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for disabling raid mode')))
  .addSubcommand(sub => sub
    .setName('status')
    .setDescription('Check if raid mode is active'));

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to manage raid mode.')] });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'enable') {
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const textChannels = interaction.guild.channels.cache.filter(
      ch => ch.isTextBased() && ch.permissionsFor(interaction.guild.id)?.has('SendMessages')
    );
    const results = await withConcurrencyLimit(
      [...textChannels.values()],
      async ch => {
        await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        return ch.id;
      }
    );
    const lockedChannels = results.filter(Boolean);
    const existing = await GuildModel.findOne({ guildId: interaction.guildId }).lean();
    const alreadyActive = existing?.raidMode?.active;
    const prevLevel = alreadyActive ? (existing.raidMode.previousVerificationLevel ?? interaction.guild.verificationLevel) : interaction.guild.verificationLevel;

    await interaction.guild.edit({ verificationLevel: 3 }).catch(() => {});

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      {
        'raidMode.active': true,
        'raidMode.triggeredAt': new Date(),
        'raidMode.triggeredBy': `${interaction.user.tag} (${interaction.user.id})`,
        'raidMode.previousVerificationLevel': prevLevel,
        'raidMode.lockedChannels': lockedChannels,
      },
      { upsert: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await createCase({
      guildId: interaction.guildId,
      type: 'lockdown',
      targetId: interaction.guildId,
      targetTag: interaction.guild.name,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason: `Raid mode enabled: ${reason}`,
    });

    await logAudit({
      guildId: interaction.guildId,
      action: 'raid_enable',
      moderatorId: interaction.user.id,
      reason,
    });

    return interaction.editReply({ embeds: [successEmbed('Raid mode enabled. Server locked down and new members will be kicked.')] });
  }

  if (subcommand === 'disable') {
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const currentCfg = await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { 'raidMode.active': false }, $unset: { 'raidMode.triggeredAt': '', 'raidMode.triggeredBy': '', 'raidMode.previousVerificationLevel': '', 'raidMode.lockedChannels': '' } }
    );

    try {
      const prevLevel = currentCfg?.raidMode?.previousVerificationLevel;
      await interaction.guild.edit({ verificationLevel: prevLevel ?? 0 }).catch(() => {});

      const lockedChannelIds = currentCfg?.raidMode?.lockedChannels || [];
      await withConcurrencyLimit(
        lockedChannelIds.map(id => interaction.guild.channels.cache.get(id)).filter(Boolean),
        ch => ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null }).catch(() => {})
      );
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Failed to disable raid mode')] });
    }

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await closeActiveCases(interaction.guildId, interaction.guildId, 'lockdown');

    await createCase({
      guildId: interaction.guildId,
      type: 'unlockdown',
      targetId: interaction.guildId,
      targetTag: interaction.guild.name,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason: `Raid mode disabled: ${reason}`,
    });

    await logAudit({
      guildId: interaction.guildId,
      action: 'raid_disable',
      moderatorId: interaction.user.id,
      reason,
    });

    return interaction.editReply({ embeds: [successEmbed('Raid mode disabled. Server restored to normal.')] });
  }

  if (subcommand === 'status') {
    const config = await GuildModel.findOne({ guildId: interaction.guildId });
    const raid = config?.raidMode;

    const embed = new EmbedBuilder()
      .setColor(raid?.active ? 0xFF0000 : 0x00FF7F)
      .setTitle('Raid Mode Status')
      .addFields(
        { name: 'Active', value: raid?.active ? 'Yes' : 'No', inline: true },
        { name: 'Triggered At', value: raid?.triggeredAt ? `<t:${Math.floor(new Date(raid.triggeredAt).getTime() / 1000)}:R>` : 'N/A', inline: true },
        { name: 'Triggered By', value: raid?.triggeredBy || 'N/A', inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
