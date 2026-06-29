const crypto = require('crypto');

const HASH_ALGO = 'sha512';
const HASH_ITERATIONS = 120000;
const HASH_KEYLEN = 64;

function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_ALGO).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_ALGO).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function normalizeRole(role) {
  return String(role || 'student').trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmailChars(email) {
  return /^[A-Za-z0-9@.]+$/.test(email);
}

function isValidEmailFormat(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const parts = normalized.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (!isValidEmailChars(normalized)) return false;
  if (!domain.includes('.')) return false;
  return true;
}

function isValidGmailEmailLocalPart(email) {
  const normalized = normalizeEmail(email);
  const parts = normalized.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return /[A-Za-z]/.test(local);
  }
  return true;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

function isValidName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (!/^[A-Za-z0-9 .'-]+$/.test(trimmed)) return false;
  return /[A-Za-z]/.test(trimmed);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  hashPassword,
  verifyPassword,
  normalizeRole,
  normalizeEmail,
  isValidEmailChars,
  isValidEmailFormat,
  isValidGmailEmailLocalPart,
  isValidPassword,
  isValidName,
  escapeHtml
};
