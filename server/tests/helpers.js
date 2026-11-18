// Test helpers: starts the real Express app on a random port and talks to it over HTTP.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/apmms_test';
process.env.UPLOAD_DIR = 'uploads-test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.COORDINATOR_SETUP_CODE = 'test-setup-code';

import http from 'http';
import mongoose from 'mongoose';
import fs from 'fs';
import env from '../config/env.js';
import { connectDB } from '../config/db.js';
import { createApp } from '../app.js';
import { initSockets } from '../sockets/index.js';
import { seed, DEMO_PASSWORD } from '../utils/seed.js';

export { DEMO_PASSWORD };
let server;
export let base;

export async function startTestServer() {
  await connectDB();
  await mongoose.connection.dropDatabase();
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  await seed({ log: () => {} });
  server = http.createServer(createApp());
  initSockets(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

export async function stopTestServer() {
  await new Promise((r) => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
}

/** A tiny HTTP client that keeps the login cookie, like a browser would. */
export class Client {
  constructor() {
    this.cookie = '';
  }
  async raw(method, path, body, { headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf) h['x-requested-with'] = 'APMMS';
    let payload = body;
    if (body && !(body instanceof FormData)) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const pair = c.split(';')[0];
      if (pair.endsWith('=')) this.cookie = '';
      else this.cookie = pair;
    }
    return res;
  }
  async call(method, path, body, opts) {
    const res = await this.raw(method, path, body, opts);
    const type = res.headers.get('content-type') || '';
    const json = type.includes('json') ? await res.json() : null;
    return { status: res.status, body: json, res };
  }
  get = (p) => this.call('GET', p);
  post = (p, b) => this.call('POST', p, b);
  put = (p, b) => this.call('PUT', p, b);
  patch = (p, b) => this.call('PATCH', p, b);
  del = (p) => this.call('DELETE', p);
  async login(email, password = DEMO_PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
    return r.body.data.user;
  }
}

import { outbox } from '../services/mailer.js';

/** Opens the newest verification email sent to `email` (from the in-memory test outbox) and verifies it. */
export async function verifyFromOutbox(email) {
  const token = latestToken(email);
  const c = new Client();
  return c.post('/api/auth/verify-email', { token });
}
export function latestToken(email) {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no email was sent to ${email}`);
  return /token=([a-f0-9]+)/.exec(mail.text)[1];
}
export { outbox };

/** Logs a platform admin in (separate cookie, separate API) and returns the client. */
export async function adminLoggedIn(email = 'admin@apmms.test', password = DEMO_PASSWORD) {
  const c = new Client();
  const r = await c.post('/api/platform/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`admin login failed for ${email}: ${JSON.stringify(r.body)}`);
  return c;
}

export const loggedIn = async (email, _role, password) => {
  const c = new Client();
  await c.login(email, password);
  return c;
};

/** Smallest valid-looking PDF (starts with %PDF-). */
export const pdfBlob = (text = 'report') =>
  new Blob([`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%${text}\n%%EOF`], { type: 'application/pdf' });

export function form(fields = {}, files = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, v);
  for (const [k, v] of Object.entries(files)) f.append(k, v.blob, v.name);
  return f;
}

/**
 * Creates an institution the way the platform does it now: the admin adds the institution, a faculty, departments and
 * invites the coordinator by email; the coordinator opens the emailed link and chooses a password.
 */
export async function createInstitutionViaAdmin(admin, { name, type = 'college', coordinator, faculty = 'Main Faculty', departments = [{ name: 'Computer Science & Engineering', code: 'CSE' }], password = 'Passw0rd1' }) {
  const r = await admin.post('/api/platform/institutions', { institutionName: name, institutionType: type, coordinatorName: coordinator.name, coordinatorEmail: coordinator.email });
  if (r.status !== 201) throw new Error(`institution not created: ${JSON.stringify(r.body)}`);
  const instId = r.body.data.institution._id;
  const f = await admin.post(`/api/platform/institutions/${instId}/faculties`, { name: faculty });
  const facultyId = f.body.data._id;
  const departmentIds = [];
  for (const d of departments) departmentIds.push((await admin.post(`/api/platform/institutions/${instId}/departments`, { ...d, facultyId })).body.data._id);
  const set = await new Client().post('/api/auth/reset-password', { token: latestToken(coordinator.email), password });
  if (set.status !== 200) throw new Error(`coordinator could not set a password: ${JSON.stringify(set.body)}`);
  return { instId, facultyId, departmentIds };
}
