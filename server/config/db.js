import mongoose from 'mongoose';
import env from './env.js';

mongoose.set('strictQuery', true);

/** Connects to MongoDB. The server only starts listening after this succeeds. */
export async function connectDB() {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 7000 });
    console.log(`[db] Connected to MongoDB (${mongoose.connection.host}/${mongoose.connection.name})`);
  } catch (err) {
    console.error('[db] Could not connect to MongoDB.');
    console.error(`     URI: ${env.mongoUri}`);
    console.error('     Is MongoDB Community Server running? (Windows: check the "MongoDB" service)');
    console.error(`     Reason: ${err.message}`);
    throw err;
  }
  mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
}

export const dbState = () =>
  ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
