'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env when running without Docker (Node 20.12+). Real environment variables win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function load(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  const timezone = env.TIMEZONE || env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!isValidTimezone(timezone)) throw new Error(`TIMEZONE "${timezone}" is not a valid IANA timezone (e.g. America/Toronto)`);

  const sendTime = env.SEND_TIME || '00:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) throw new Error(`SEND_TIME "${sendTime}" must be HH:MM (24h), e.g. 00:00`);

  return {
    dataDir,
    timezone,
    sendTime,
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    password: env.DASHBOARD_PASSWORD || null,
    minDelaySec: num(env.MIN_DELAY_SEC, 8),
    maxDelaySec: num(env.MAX_DELAY_SEC, 30),
    upcomingDays: num(env.UPCOMING_DAYS, 30),
    whatsappEnabled: (env.WHATSAPP || 'on').toLowerCase() !== 'off' && !process.argv.includes('--no-whatsapp'),
    chromiumPath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
  };
}

// If no password is set, generate one once and keep it in the data folder,
// so it survives restarts and is printed in the logs for the owner.
function resolvePassword(config) {
  if (config.password) return { password: config.password, generated: false };
  const file = path.join(config.dataDir, '.dashboard-password');
  if (fs.existsSync(file)) return { password: fs.readFileSync(file, 'utf8').trim(), generated: true };
  const password = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(file, password + '\n', { mode: 0o600 });
  return { password, generated: true };
}

module.exports = { load, resolvePassword, isValidTimezone };
