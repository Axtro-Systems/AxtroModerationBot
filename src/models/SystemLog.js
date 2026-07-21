import mongoose from 'mongoose';

const SystemLogSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  action: { type: String, required: true },
  executorId: String,
  targetId: String,
  reason: String,
  details: String,
  timestamp: { type: Date, default: Date.now }
});

export const SystemLogModel = mongoose.model('SystemLog', SystemLogSchema);
