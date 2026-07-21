import mongoose from 'mongoose';

const TicketTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  staffRoleId: { type: String, default: null },
}, { _id: false });

const PanelSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, default: '🎫 Open a Ticket' },
  description: { type: String, default: 'Click the button below to open a ticket.' },
  channelId: { type: String, default: null },
  messageId: { type: String, default: null },
  color: { type: Number, default: 0x5865F2 },
  ticketTypes: { type: [String], default: [] },
}, { _id: false });

const TicketSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  categoryId: { type: String, default: null },
  staffRoleIds: { type: [String], default: [] },
  panelChannelId: { type: String, default: null },
  logChannelId: { type: String, default: null },
  ticketTypes: { type: [TicketTypeSchema], default: [] },
  maxTicketsPerUser: { type: Number, default: 1 },
  ticketCounter: { type: Number, default: 0 },
  panels: { type: [PanelSchema], default: [] },
});

export const TicketSettingsModel = mongoose.model('TicketSettings', TicketSettingsSchema);
