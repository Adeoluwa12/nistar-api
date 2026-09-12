import mongoose from 'mongoose';
import logger from '../utils/logger';

let connectionPromise: Promise<void> | null = null;

const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) return;

  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const uri = process.env.MONGODB_URI as string;
      await mongoose.connect(uri, {
        maxPoolSize: 10,
        connectTimeoutMS: 10000,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
      });
      logger.info('MongoDB connected successfully');

      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected. Attempting to reconnect...');
        connectionPromise = null;
      });
    } catch (err) {
      connectionPromise = null;
      logger.error('MongoDB connection failed:', err);
      throw err;
    }
  })();

  return connectionPromise;
};

export default connectDB;
