import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import mongoose from 'mongoose';
import { errorEmbed, successEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

export const defer = true;

export const data = new SlashCommandBuilder()
  .setName('restart')
  .setDescription('Restart the bot and clear in-memory caches (Owner Only)');

export async function execute(interaction, client) {
  const ownerId = client.config?.ownerId;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.editReply({ embeds: [errorEmbed('Only the bot owner can execute this command.')] });
  }

  await interaction.editReply({
    embeds: [successEmbed('🔄 **Restarting bot...**\nClearing all guild config caches, cooldown maps, disconnecting DB connections, and restarting the host process.')]
  }).catch(() => {});

  logger.info(`Restart command triggered by owner ${interaction.user.tag} (${interaction.user.id})`);

  try {
    // 1. Clear client caches
    if (client.guildConfigs && typeof client.guildConfigs.clear === 'function') {
      client.guildConfigs.clear();
    }
    if (client.cooldowns && typeof client.cooldowns.clear === 'function') {
      client.cooldowns.clear();
    }
    
    // Clear ticket setup state cache
    try {
      const { setupState } = await import('../ticket/ticket.js');
      if (setupState && typeof setupState.clear === 'function') {
        setupState.clear();
      }
    } catch {}

    // 2. Close HTTP Server to release port 3000
    if (client.httpServer && typeof client.httpServer.close === 'function') {
      await new Promise(r => client.httpServer.close(r)).catch(() => {});
      logger.info('HTTP server closed for reboot');
    }

    // 3. Graceful database disconnect
    await mongoose.disconnect().catch(() => {});
    logger.info('Mongoose disconnected for reboot');

    // 4. Destroy Discord connection
    client.destroy();
    logger.info('Discord client destroyed for reboot');

    // 5. Spawn new detached child process of the bot and exit parent
    const { spawn } = await import('child_process');
    logger.info('Spawning new bot process...');
    
    const child = spawn(process.argv[0], process.argv.slice(1), {
      detached: true,
      stdio: 'inherit'
    });
    child.unref();

    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (err) {
    logger.error(`Error during restart: ${err.message}`, err);
    await interaction.followUp({ embeds: [errorEmbed(`Failed to execute reboot: ${err.message}`)] }).catch(() => {});
  }
}
