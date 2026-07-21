import mongoose from 'mongoose';

const QuarantineSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  released: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true }
});

QuarantineSchema.index({ expiresAt: 1 });
QuarantineSchema.index({ guildId: 1, userId: 1, released: 1 });

export const QuarantineModel = mongoose.model('Quarantine', QuarantineSchema);
