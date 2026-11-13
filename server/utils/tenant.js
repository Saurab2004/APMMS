// "Which institution is this code running for?" - kept in AsyncLocalStorage so every database query
// made while handling a request is automatically limited to the logged-in user's institution
// (see models/tenantPlugin.js). No context = public routes and background jobs (not limited).
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

export const currentInstitution = () => als.getStore()?.institution || null;

/** Runs fn with all queries limited to one institution. */
export const runInInstitution = (institutionId, fn) => als.run({ institution: institutionId ? String(institutionId) : null }, fn);

/** Runs fn with NO institution limit. Only for platform-owner features, login/registration lookups and migrations. */
export const runUnscoped = (fn) => als.run({ institution: null }, fn);
