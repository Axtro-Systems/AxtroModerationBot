import mongoose from 'mongoose';

const WelcomeSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  channelId: { type: String, default: null },
  messageTemplate: {
    type: String,
    default: 'Welcome {user} to {server}!\nWe are honoured to have you in our community!\nMake sure to check out {rules}.\n~ Thank you ~'
  },
  welcomeImageUrl: { type: String, default: null },
  roleId: { type: String, default: null },
  enabled: { type: Boolean, default: false },
});

export const WelcomeSettingsModel = mongoose.model('WelcomeSettings', WelcomeSettingsSchema);
