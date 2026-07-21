import 'dotenv/config';

const SNOWFLAKE_RE = /^\d{17,20}$/;

const requiredEnvVars = ['BOT_TOKEN', 'CLIENT_ID', 'MONGO_URI', 'GROQ_API_KEY'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Check your .env file.`);
  }
}

const rawOwnerId = process.env.OWNER_ID || '';
if (rawOwnerId && !SNOWFLAKE_RE.test(rawOwnerId)) {
  throw new Error(`Invalid OWNER_ID in .env: "${rawOwnerId}" is not a valid snowflake`);
}

export const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  ownerId: rawOwnerId,
  logLevel: process.env.LOG_LEVEL || 'info',
  groqApiKey: process.env.GROQ_API_KEY,
  welcomeTemplate: process.env.WELCOME_TEMPLATE || 'Welcome {user} to {server}!\nWe are honoured to have you in our community!\nMake sure to check out {rules}.\n~ Thank you ~',
  welcomeImageUrl: process.env.WELCOME_IMAGE_URL || null,

  alertChannelId: process.env.ALERT_CHANNEL_ID || '1520686423093543002',
  alertUserIds: [
    '1515179179212280029',
    '1515179316869071010',
    '1515179408699428944',
  ],

  colors: {
    warn: 0xFFD700,
    mute: 0xFFA500,
    tempmute: 0xFFA500,
    kick: 0xFF6B35,
    ban: 0xFF0000,
    tempban: 0xFF0000,
    softban: 0xFF0000,
    unban: 0x00FF7F,
    unmute: 0x00FF7F,
    lock: 0x5865F2,
    lockdown: 0x5865F2,
    unlock: 0x00FF7F,
    note: 0x95a5a6,
    antinuke: 0x8B0000,
    default: 0x5865F2,
  },
};
