// File storage service. Today it writes to the local disk; to move to S3/GCS later,
// replace saveUpload / readStream / removeFile and keep the same function signatures.
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isText = (b) => !b.subarray(0, 8000).includes(0);

/** For every allowed extension: the MIME types browsers may send, plus a "magic byte" check on the real content. */
export const FILE_RULES = {
  pdf: { mimes: ['application/pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', inline: true },
  docx: { mimes: [DOCX], magic: isZip },
  pptx: { mimes: [PPTX], magic: isZip },
  xlsx: { mimes: [XLSX], magic: isZip },
  zip: { mimes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], magic: isZip },
  png: { mimes: ['image/png'], magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47, inline: true },
  jpg: { mimes: ['image/jpeg'], magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, inline: true },
  jpeg: { mimes: ['image/jpeg'], magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, inline: true },
  txt: { mimes: ['text/plain'], magic: isText },
};

/** Which extensions each kind of upload accepts. */
export const CATEGORY_EXTENSIONS = {
  report: ['pdf', 'docx'],
  attachment: ['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'jpeg', 'txt'],
  chat: ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'txt', 'zip'],
  repository: ['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'jpeg', 'txt'],
};

export const extOf = (name = '') => path.extname(String(name)).slice(1).toLowerCase();

/** Removes path parts, control characters and odd symbols from an uploaded filename. */
export function sanitizeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const cleaned = base
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

/** Throws AppError if the uploaded file is not acceptable. Never trusts the name or MIME alone. */
export function validateUpload(file, category) {
  if (!file || !file.buffer) throw new AppError('No file received', 400);
  const allowed = CATEGORY_EXTENSIONS[category];
  if (!allowed) throw new AppError('Unknown upload category', 500);
  const ext = extOf(file.originalname);
  if (!allowed.includes(ext)) {
    throw new AppError(`File type ".${ext || '?'}" is not allowed here. Allowed: ${allowed.join(', ')}`, 415);
  }
  const rule = FILE_RULES[ext];
  if (!rule.mimes.includes(file.mimetype)) {
    throw new AppError(`The file's declared type (${file.mimetype}) does not match ".${ext}"`, 415);
  }
  if (file.size === 0 || file.buffer.length === 0) throw new AppError('The uploaded file is empty', 422);
  if (!rule.magic(file.buffer)) {
    throw new AppError(`The file content does not look like a real .${ext} file`, 415);
  }
  return { ext, rule };
}

const SCOPE_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function absolutePath(relative) {
  const root = path.resolve(env.uploadDir);
  const abs = path.resolve(root, relative);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new AppError('Invalid file path', 400);
  }
  return abs;
}

/** Validates then stores one file. Returns the metadata we keep in MongoDB. */
export async function saveUpload(file, { category, scope = 'general', folder = category }) {
  const { ext } = validateUpload(file, category);
  if (!SCOPE_RE.test(scope) || !SCOPE_RE.test(folder)) throw new AppError('Invalid storage location', 500);
  const storedName = `${crypto.randomUUID()}.${ext}`;
  const relative = path.posix.join(folder, scope, storedName);
  const abs = absolutePath(relative);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, file.buffer, { flag: 'wx' });
  return {
    originalName: sanitizeFilename(file.originalname),
    storedName,
    storagePath: relative,
    mimeType: file.mimetype,
    size: file.size,
    extension: ext,
    uploadedAt: new Date(),
  };
}

export async function saveMany(files = [], opts) {
  const saved = [];
  try {
    for (const f of files) saved.push(await saveUpload(f, opts));
  } catch (err) {
    await Promise.all(saved.map(removeFile));
    throw err;
  }
  return saved;
}

export async function removeFile(meta) {
  if (!meta?.storagePath) return;
  try {
    await fsp.unlink(absolutePath(meta.storagePath));
  } catch {
    /* already gone */
  }
}

const asciiName = (n) => n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

/** Streams a stored file to the client. Authorisation must be checked BEFORE calling this. */
export async function sendStoredFile(res, meta, { inline = false } = {}) {
  if (!meta?.storagePath) throw new AppError('File not found', 404);
  const abs = absolutePath(meta.storagePath);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new AppError('The file is missing on the server', 404);
  }
  const rule = FILE_RULES[meta.extension];
  const disposition = inline && rule?.inline ? 'inline' : 'attachment';
  res.setHeader('Content-Type', rule?.mimes[0] === 'application/octet-stream' ? 'application/zip' : meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${asciiName(meta.originalName)}"; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    res.on('close', resolve);
    stream.pipe(res);
  });
}

/** Multer keeps files in memory (size-limited) so we can inspect them before writing to disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMB * 1024 * 1024, files: 8, fields: 40, parts: 60 },
});

export const dirSize = async (dir) => {
  let total = 0;
  const walk = async (d) => {
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else total += (await fsp.stat(p)).size;
    }
  };
  await walk(dir);
  return total;
};
