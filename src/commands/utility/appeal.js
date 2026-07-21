import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CaseModel } from '../../models/Case.js';
import { AppealModel } from '../../models/Appeal.js';
import { WarnModel } from '../../models/Warn.js';
import { errorEmbed } from '../../utils/embed.js';

export const data = new SlashCommandBuilder()
  .setName('appeal')
  .setDescription('Request an appeal for an active warning, timeout, or ban')
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .addStringOption(opt => opt.setName('case-id').setDescription('Optional: Case Number if you know it').setRequired(false));

export const cooldown = 10000;

export async function execute(interaction, client) {
  const manualCaseId = interaction.options.getString('case-id');
  const isGuild = !!interaction.guildId;

  // Find active punishment cases for this user
  let query = { targetId: interaction.user.id, type: { $in: ['warn', 'mute', 'tempmute', 'ban', 'tempban'] } };
  if (isGuild) {
    query.guildId = interaction.guildId;
  }
  if (manualCaseId) {
    const parsed = parseInt(manualCaseId, 10);
    if (!isNaN(parsed)) {
      query.caseNumber = parsed;
    }
  }

  const cases = await CaseModel.find(query).sort({ createdAt: -1 }).limit(10).lean();

  if (!cases || cases.length === 0) {
    return interaction.editReply({
      embeds: [errorEmbed('No active or recent punishments were found under your account to appeal.')]
    });
  }

  // Pick target case (latest case)
  const targetCase = cases[0];
  const caseGuildId = targetCase.guildId;

  // Check if there is already a pending appeal
  const existingAppeal = await AppealModel.findOne({ guildId: caseGuildId, userId: interaction.user.id, caseId: String(targetCase.caseNumber), status: 'pending' });
  if (existingAppeal) {
    return interaction.editReply({
      embeds: [errorEmbed(`You already have a pending appeal for Case #${targetCase.caseNumber}. Please wait for staff to review it.`)]
    });
  }

  // Fetch Guild details for branding
  let guildName = 'Server';
  if (client.guilds.cache.has(caseGuildId)) {
    guildName = client.guilds.cache.get(caseGuildId).name;
  }

  // Fetch active warnings for points display
  const activeWarnings = await WarnModel.find({ guildId: caseGuildId, userId: interaction.user.id, active: true }).lean();
  const warningScore = activeWarnings.reduce((sum, w) => sum + (w.points || 1), 0);

  // Format punishment type & duration nicely
  let typeLabel = targetCase.type.toUpperCase();
  if (targetCase.type === 'warn') typeLabel = '⚠️ WARNING';
  else if (targetCase.type === 'tempmute' || targetCase.type === 'mute') typeLabel = '⏳ TIMEOUT (MUTE)';
  else if (targetCase.type === 'ban' || targetCase.type === 'tempban') typeLabel = '🔨 BAN';

  const caseTimeUnix = Math.floor(targetCase.createdAt.getTime() / 1000);

  const requestEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋 Request Appeal | Case #${targetCase.caseNumber}`)
    .setDescription(`Below are the details of your recorded punishment in **${guildName}**.\nClick **Submit Explanation** to submit your appeal directly to server staff.`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🛡️ Server', value: guildName, inline: true },
      { name: '⚖️ Punishment', value: `\`${typeLabel}\``, inline: true },
      { name: '📊 Active Warning Score', value: `\`${warningScore}/5 Points\``, inline: true },
      { name: '📌 Original Reason', value: `>>> ${targetCase.reason || 'No reason specified'}`, inline: false },
      { name: '📅 Issued On', value: `<t:${caseTimeUnix}:f> (<t:${caseTimeUnix}:R>)`, inline: false }
    )
    .setFooter({ text: 'Axtro Systems • Appeal Portal' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_open_modal_${caseGuildId}_${targetCase.caseNumber}`)
      .setLabel('📝 Submit Explanation')
      .setStyle(ButtonStyle.Primary)
  );

  return interaction.editReply({
    embeds: [requestEmbed],
    components: [row]
  });
}
