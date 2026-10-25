'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { Scheduler, MAX_ATTEMPTS } = require('../src/scheduler');

const quiet = { info() {}, error() {} };
const config = { sendTime: '00:00', timezone: 'America/Toronto', minDelaySec: 0, maxDelaySec: 0 };

function setup(nowIso, sendImpl) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'bday-')));
  store.upsertPerson({ name: 'Jordan', phone: '19055550103', birthday: '1999-10-26' });
  store.upsertPerson({ name: 'Priya', phone: '919800000000', birthday: '10-26', timezone: 'Asia/Kolkata' });
  const sent = [];
  const whatsapp = { isReady: () => true, send: sendImpl || (async (phone, msg) => sent.push({ phone, msg })) };
  let now = new Date(nowIso);
  const s = new Scheduler({ store, whatsapp, config, log: quiet, now: () => now, sleep: async () => {} });
  return { s, store, sent, setNow: (iso) => { now = new Date(iso); } };
}

test('sends in each person’s timezone, once per year', async () => {
  // 15:00 Toronto Oct 25 = 00:30 Oct 26 in Kolkata
  const { s, sent, setNow } = setup('2026-10-25T19:00:00Z');
  await s.tick();
  assert.deepEqual(sent.map((x) => x.phone), ['919800000000']);

  setNow('2026-10-26T04:00:30Z'); // just after midnight Toronto
  await s.tick();
  assert.deepEqual(sent.map((x) => x.phone), ['919800000000', '19055550103']);

  await s.tick(); // nothing new
  assert.equal(sent.length, 2);
});

test('catches up after downtime on the same day', async () => {
  const { s, sent } = setup('2026-10-26T20:00:00Z'); // 4pm Toronto on the birthday
  await s.tick();
  assert.ok(sent.some((x) => x.phone === '19055550103'));
});

test('does nothing while WhatsApp is disconnected', async () => {
  const { s, sent } = setup('2026-10-26T05:00:00Z');
  s.whatsapp.isReady = () => false;
  await s.tick();
  assert.equal(sent.length, 0);
});

test('backs off after a failure and gives up after max attempts', async () => {
  let calls = 0;
  const { s, setNow } = setup('2026-10-26T05:00:00Z', async () => { calls++; throw new Error('boom'); });
  await s.tick();
  const first = calls;
  await s.tick(); // within back-off window: no retry
  assert.equal(calls, first);
  for (let i = 1; i <= MAX_ATTEMPTS + 2; i++) {
    setNow(new Date(Date.parse('2026-10-26T05:00:00Z') + i * 11 * 60000).toISOString());
    await s.tick();
  }
  assert.equal(s.failuresFor('19055550103').attempts, MAX_ATTEMPTS);
});
