import mongoose from 'mongoose';
import dns from 'dns';
import { logger } from './utils/logger.js';

dns.setServers([
  '8.8.8.8',
  '8.8.4.4',
  '2001:4860:4860::8888',
  '2001:4860:4860::8844',
]);

export async function connectMongo(uri) {
  const MAX_RETRIES = 5;
  const BACKOFF_MS = 5000;

  mongoose.connection.on('connected', () => {
    logger.info('Connected to MongoDB');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('Disconnected from MongoDB');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('Reconnected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(uri);
      return;
    } catch (err) {
      logger.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) {
        logger.error('Exhausted all MongoDB connection retries');
        throw err;
      }
      await new Promise(r => setTimeout(r, BACKOFF_MS * attempt));
    }
  }
}
