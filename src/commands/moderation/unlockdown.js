import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, closeActiveCases, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { withConcurrencyLimit } from '../../utils/concurrency.js';
import { GuildModel } from '../../models/Guild.js';

export const data = new SlashCommandBuilder()
  .setName('unlockdown')
  .setDescription('Unlock all text channels in the server')
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unlock').setRequired(false));

export const cooldown = 30000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage channels.')] });
  }

  if (!botHasPermissions(interaction.guild, requiredPerms.manageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to manage channels.')] });
  }

  const reason = interaction.options.getString('reason') || 'No reason provided';
  const everyoneRole = interaction.guild.roles.everyone;

  const textChannels = interaction.guild.channels.cache.filter(c => c.isTextBased() && !c.isDMBased());

  let unlocked = 0;
  await withConcurrencyLimit(
    [...textChannels.values()],
    async channel => {
      await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
      unlocked++;
    }
  );

  await closeActiveCases(interaction.guildId, interaction.guildId, 'lockdown');

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'unlockdown',
    targetId: interaction.guildId,
    targetTag: interaction.guild.name,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'unlockdown',
    moderatorId: interaction.user.id,
    targetId: interaction.guildId,
    reason,
    details: `Unlocked ${unlocked} channels`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] }).catch(() => {});
    }
  }

  const reply = `Unlocked **${unlocked}** channel(s) | Case #${caseEntry.caseNumber}`;
  return interaction.editReply({ embeds: [successEmbed(reply)] });
}
