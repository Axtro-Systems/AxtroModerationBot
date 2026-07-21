import mongoose from 'mongoose';

const TicketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true },
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  openerId: { type: String, required: true },
  type: { type: String, default: 'General Support' },
  status: { type: String, enum: ['open', 'closed', 'deleted'], default: 'open' },
  claimedBy: { type: String, default: null },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
  closeReason: { type: String, default: null },
});

export const TicketModel = mongoose.model('Ticket', TicketSchema);
