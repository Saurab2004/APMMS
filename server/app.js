import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import env from './config/env.js';
import { dbState } from './config/db.js';
import { apiLimiter, csrfGuard } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();
  if (env.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Content-Security-Policy tuned for this app: same-origin scripts, Google Fonts, blob: for the PDF preview.
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        'font-src': ["'self'", 'https:', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'upgrade-insecure-requests': null, // would break plain-http testing on a local network
      },
    },
  }));
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', database: dbState() } }));

  app.use('/api', apiLimiter, csrfGuard, routes);
  // NOTE: server/uploads is never served statically. Files are streamed only by the
  // authorised download endpoints, so knowing a file URL gives nobody access.
  // One-service hosting: if the website has been built (client/dist), this server also serves it.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp;
