import mongoose from 'mongoose';
import { AppError } from './AppError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates and sanitises one value against a rule.
 * Returns { value } or { error }.
 */
export function checkValue(raw, rule, key) {
  const label = rule.label || key;
  let v = typeof raw === 'string' ? raw.trim() : raw;
  const type = rule.type || 'string';

  switch (type) {
    case 'string': {
      if (typeof v !== 'string') return { error: `${label} must be text` };
      if (rule.min && v.length < rule.min) return { error: `${label} must be at least ${rule.min} characters` };
      const max = rule.max || 2000;
      if (v.length > max) return { error: `${label} must be at most ${max} characters` };
      return { value: v };
    }
    case 'email': {
      if (typeof v !== 'string' || !EMAIL_RE.test(v) || v.length > 200) return { error: `${label} must be a valid email address` };
      return { value: v.toLowerCase() };
    }
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) return { error: `${label} must be a number` };
      if (rule.min !== undefined && n < rule.min) return { error: `${label} must be at least ${rule.min}` };
      if (rule.max !== undefined && n > rule.max) return { error: `${label} must be at most ${rule.max}` };
      return { value: n };
    }
    case 'boolean': {
      if (v === true || v === 'true' || v === '1' || v === 1) return { value: true };
      if (v === false || v === 'false' || v === '0' || v === 0) return { value: false };
      return { error: `${label} must be true or false` };
    }
    case 'enum': {
      if (!rule.values.includes(v)) return { error: `${label} must be one of: ${rule.values.join(', ')}` };
      return { value: v };
    }
    case 'objectId': {
      if (!mongoose.isValidObjectId(v) || String(v).length !== 24) return { error: `${label} is not a valid id` };
      return { value: String(v) };
    }
    case 'date': {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return { error: `${label} must be a valid date` };
      return { value: d };
    }
    case 'array': {
      if (!Array.isArray(v)) return { error: `${label} must be a list` };
      if (rule.maxItems && v.length > rule.maxItems) return { error: `${label} has too many items (max ${rule.maxItems})` };
      if (rule.of) {
        const out = [];
        for (const item of v) {
          const r = checkValue(item, rule.of, label);
          if (r.error) return { error: r.error };
          out.push(r.value);
        }
        return { value: out };
      }
      return { value: v };
    }
    case 'object': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return { error: `${label} must be an object` };
      return { value: v };
    }
    default:
      return { value: v };
  }
}

/** Validates a plain object against a schema. Unknown fields are dropped. */
export function validateObject(input, schema) {
  const errors = {};
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const raw = input?.[key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (rule.required) errors[key] = `${rule.label || key} is required`;
      else if (rule.default !== undefined) out[key] = rule.default;
      continue;
    }
    const r = checkValue(raw, rule, key);
    if (r.error) errors[key] = r.error;
    else out[key] = r.value;
  }
  return { errors, value: out };
}

/** Express middleware: replaces req.body with the validated, whitelisted body. */
export function validate(schema) {
  return (req, _res, next) => {
    const { errors, value } = validateObject(req.body || {}, schema);
    if (Object.keys(errors).length) {
      return next(new AppError('Please correct the highlighted fields', 422, errors));
    }
    req.body = value;
    next();
  };
}

export { EMAIL_RE };
