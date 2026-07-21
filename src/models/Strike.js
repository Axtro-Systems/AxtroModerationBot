import mongoose from 'mongoose';

const StrikeSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  strikes: { type: Number, default: 0 },
});

StrikeSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const StrikeModel = mongoose.model('Strike', StrikeSchema);
