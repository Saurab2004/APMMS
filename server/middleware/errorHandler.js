import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function notFound(req, _res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

// Centralised error handler. Clients never see stack traces.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message;
  let details = err.details;
  const code = err.appCode;

  if (err.name === 'ValidationError' && err.errors) {
    status = 422;
    message = 'Validation failed';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409;
    message = 'A record with the same unique value already exists';
  } else if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (maximum ${env.maxUploadMB} MB)` : `Upload problem: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (err.name === 'MongooseError' && /buffering timed out/i.test(err.message)) {
    status = 503;
    message = 'The database is not reachable right now';
  } else if (!(err instanceof AppError)) {
    status = 500;
    message = 'Something went wrong on the server';
    console.error('[error]', err);
  } else if (status >= 500) {
    console.error('[error]', err);
  }

  if (res.headersSent) return res.end();
  res.status(status).json({ success: false, message, ...(details ? { details } : {}), ...(code ? { code } : {}) });
}
