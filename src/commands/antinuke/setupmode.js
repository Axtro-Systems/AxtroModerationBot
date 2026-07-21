import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { GuildModel } from '../../models/Guild.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed, successEmbed, simpleEmbed } from '../../utils/embed.js';
import { setSetupModeCache } from '../../handlers/antiNukeHandler.js';

export const data = new SlashCommandBuilder()
  .setName('setup-mode')
  .setDescription('Toggle server Setup Mode to temporarily raise Anti-Nuke thresholds during server restructuring')
  .addSubcommand(sub =>
    sub.setName('on')
      .setDescription('Enable Setup Mode (raises Anti-Nuke thresholds by 5x)')
      .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. "30m", "1h", "2h" (default: 30m)'))
  )
  .addSubcommand(sub =>
    sub.setName('off')
      .setDescription('Disable Setup Mode immediately')
  )
  .addSubcommand(sub =>
    sub.setName('status')
      .setDescription('Check current Setup Mode status')
  );

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.administrator)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to manage Setup Mode.')] });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'on') {
    const durStr = interaction.options.getString('duration') || '30m';
    const ms = parseDuration(durStr) || (30 * 60 * 1000);
    const expiresAt = new Date(Date.now() + ms);

    await GuildModel.findOneAndUpdate(
      { guildId },
      {
        $set: {
          'setupMode.enabled': true,
          'setupMode.expiresAt': expiresAt,
          'setupMode.enabledBy': interaction.user.id
        }
      },
      { upsert: true }
    );

    setSetupModeCache(guildId, true, expiresAt.getTime());

    const timeUnix = Math.floor(expiresAt.getTime() / 1000);
    return interaction.editReply({
      embeds: [successEmbed(`🔧 **Setup Mode ENABLED**! Anti-Nuke threshold limits are temporarily raised by **5x** to allow legitimate server restructuring.\nMode will expire automatically at <t:${timeUnix}:f> (<t:${timeUnix}:R>).`)]
    });
  }

  if (sub === 'off') {
    await GuildModel.findOneAndUpdate(
      { guildId },
      {
        $set: {
          'setupMode.enabled': false,
          'setupMode.expiresAt': null,
          'setupMode.enabledBy': null
        }
      }
    );

    setSetupModeCache(guildId, false, 0);

    return interaction.editReply({
      embeds: [successEmbed('✅ **Setup Mode DISABLED**. Standard Anti-Nuke protection thresholds are now active.')]
    });
  }

  if (sub === 'status') {
    const guildDoc = await GuildModel.findOne({ guildId }).lean();
    const setup = guildDoc?.setupMode;
    const isActive = setup?.enabled && setup.expiresAt && new Date(setup.expiresAt).getTime() > Date.now();

    if (isActive) {
      const timeUnix = Math.floor(new Date(setup.expiresAt).getTime() / 1000);
      return interaction.editReply({
        embeds: [simpleEmbed({
          color: 0xFFD700,
          title: '🔧 Setup Mode Status',
          description: `**Status**: \`ACTIVE\`\n**Enabled By**: <@${setup.enabledBy}>\n**Expires**: <t:${timeUnix}:f> (<t:${timeUnix}:R>)\n\n*Anti-Nuke limits are currently raised by 5x.*`
        })]
      });
    }

    return interaction.editReply({
      embeds: [simpleEmbed({
        color: 0x00FF7F,
        title: '🛡️ Setup Mode Status',
        description: '**Status**: `INACTIVE` (Standard Anti-Nuke Thresholds Active)'
      })]
    });
  }
}

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
