import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId || '1200849100086710423');
  if (!guild) {
    console.log('Guild not found');
    process.exit(1);
  }
  
  try {
    await guild.emojis.fetch();
    console.log('EMOJIS_START');
    guild.emojis.cache.forEach(e => {
      console.log(`Name: ${e.name} | ID: ${e.id} | URL: ${e.url}`);
    });
    console.log('EMOJIS_END');
  } catch (err) {
    console.error('Error fetching emojis:', err.message);
  }
  process.exit(0);
});

client.login(config.token);
