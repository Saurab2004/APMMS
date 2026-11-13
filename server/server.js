import http from 'http';
import env from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { startReminderTimer } from './services/reminders.js';
import { migrateToInstitutions } from './services/migration.js';
import { startPurgeTimer } from './services/institutionPurge.js';

async function main() {
  // The server only starts accepting requests after MongoDB is reachable.
  await connectDB();
  await migrateToInstitutions(); // safe to run every time
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  startReminderTimer();
  startPurgeTimer();
  server.listen(env.port, () => console.log(`[server] APMMS API running on http://localhost:${env.port}  (${env.nodeEnv})`));

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
