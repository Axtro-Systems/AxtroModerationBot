import mongoose from 'mongoose';

const AntiNukeSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  action: String,
  count: { type: Number, default: 1 },
  windowStart: { type: Date, default: Date.now },
  flagged: { type: Boolean, default: false },
  punished: { type: Boolean, default: false },
});

AntiNukeSchema.index({ guildId: 1, userId: 1 });

export const AntiNukeModel = mongoose.model('AntiNuke', AntiNukeSchema);
