import mongoose from 'mongoose';

const UserAskLimitSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now }
});

export const UserAskLimitModel = mongoose.model('UserAskLimit', UserAskLimitSchema);
