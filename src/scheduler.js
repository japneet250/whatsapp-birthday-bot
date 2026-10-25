'use strict';

const { isDue, buildMessage } = require('./birthdays');

const RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Checks every `intervalMs` whether anyone's message is due (their birthday, in their timezone,
 * past SEND_TIME, not yet sent this year). Because it checks continuously instead of firing once
 * at midnight, a restart or outage just means the message goes out late instead of never.
 */
class Scheduler {
  constructor({ store, whatsapp, config, log = console, now = () => new Date(), sleep, intervalMs = 30000 }) {
    this.store = store;
    this.whatsapp = whatsapp;
    this.config = config;
    this.log = log;
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.intervalMs = intervalMs;
    this.failures = new Map();
    this.running = false;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error('Scheduler error:', e)), this.intervalMs);
    this.tick().catch((e) => this.log.error('Scheduler error:', e));
  }

  stop() {
    clearInterval(this.timer);
  }

  dueNow() {
    const now = this.now();
    const sent = this.store.readSent();
    const due = [];
    for (const person of this.store.listPeople()) {
      const hit = isDue(person, now, this.config);
      if (!hit || sent[hit.key]) continue;
      const fail = this.failures.get(hit.key);
      if (fail && (fail.attempts >= MAX_ATTEMPTS || fail.retryAt > now.getTime())) continue;
      due.push({ person, ...hit });
    }
    return due;
  }

  async tick() {
    if (this.running || !this.whatsapp.isReady()) return;
    this.running = true;
    try {
      const due = this.dueNow();
      if (due.length) this.log.info(`${due.length} birthday message(s) due`);
      const templates = this.store.readTemplates();

      for (let i = 0; i < due.length; i++) {
        const { person, key, year } = due[i];
        const message = buildMessage(person, templates, year);
        try {
          await this.whatsapp.send(person.phone, message);
          this.store.markSent(key, { name: person.name, phone: person.phone, message, at: this.now().toISOString() });
          this.failures.delete(key);
          this.log.info(`Sent birthday message to ${person.name}`);
        } catch (err) {
          const prev = this.failures.get(key) || { attempts: 0 };
          const attempts = prev.attempts + 1;
          this.failures.set(key, { attempts, retryAt: this.now().getTime() + RETRY_AFTER_MS, error: err.message });
          this.log.error(`Could not send to ${person.name} (attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message}`);
        }
        if (i < due.length - 1) {
          const { minDelaySec, maxDelaySec } = this.config;
          await this.sleep((minDelaySec + Math.random() * Math.max(0, maxDelaySec - minDelaySec)) * 1000);
        }
      }
    } finally {
      this.running = false;
    }
  }

  failuresFor(phone) {
    for (const [key, f] of this.failures) if (key.startsWith(phone + ':')) return f;
    return null;
  }
}

module.exports = { Scheduler, MAX_ATTEMPTS };
