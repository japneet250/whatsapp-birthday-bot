'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../src/birthdays');

const person = (over = {}) => ({ name: 'Sam Lee', phone: '14165550101', ...b.parseBirthday('1999-10-26'), extra: {}, message: '', timezone: '', ...over });

test('parseBirthday accepts YYYY-MM-DD and MM-DD, rejects nonsense', () => {
  assert.deepEqual(b.parseBirthday('1999-10-26'), { year: 1999, month: 10, day: 26 });
  assert.deepEqual(b.parseBirthday('02-29'), { year: null, month: 2, day: 29 });
  assert.equal(b.parseBirthday('2001-02-29'), null);
  assert.equal(b.parseBirthday('13-01'), null);
  assert.equal(b.parseBirthday('04-31'), null);
  assert.equal(b.parseBirthday('Oct 26'), null);
});

test('ordinal handles teens', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(b.ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});

test('Feb 29 birthdays fall on Feb 28 in non-leap years', () => {
  const p = person(b.parseBirthday('2000-02-29'));
  assert.equal(b.isBirthdayOn(p, { y: 2027, m: 2, d: 28 }), true);
  assert.equal(b.isBirthdayOn(p, { y: 2028, m: 2, d: 28 }), false);
  assert.equal(b.isBirthdayOn(p, { y: 2028, m: 2, d: 29 }), true);
});

test('zonedTimeToUtc handles DST', () => {
  // Toronto midnight in summer is 04:00Z, in winter 05:00Z
  assert.equal(new Date(b.zonedTimeToUtc(2026, 7, 1, 0, 0, 'America/Toronto')).toISOString(), '2026-07-01T04:00:00.000Z');
  assert.equal(new Date(b.zonedTimeToUtc(2026, 12, 1, 0, 0, 'America/Toronto')).toISOString(), '2026-12-01T05:00:00.000Z');
  assert.equal(new Date(b.zonedTimeToUtc(2026, 10, 26, 0, 0, 'Asia/Kolkata')).toISOString(), '2026-10-25T18:30:00.000Z');
});

test('isDue respects each person’s timezone', () => {
  const opts = { sendTime: '00:00', timezone: 'America/Toronto' };
  const at = new Date('2026-10-25T19:00:00Z'); // 3pm Toronto Oct 25, 00:30 Kolkata Oct 26
  assert.equal(b.isDue(person(), at, opts), null);
  const due = b.isDue(person({ timezone: 'Asia/Kolkata' }), at, opts);
  assert.deepEqual(due, { year: 2026, key: '14165550101:2026' });
});

test('isDue waits for send time', () => {
  const opts = { sendTime: '09:00', timezone: 'America/Toronto' };
  assert.equal(b.isDue(person(), new Date('2026-10-26T12:59:00Z'), opts), null); // 8:59
  assert.ok(b.isDue(person(), new Date('2026-10-26T13:00:00Z'), opts)); // 9:00
});

test('buildMessage: custom message wins and fills variables', () => {
  const msg = b.buildMessage(person({ message: 'Yo {first}, {ordinal}!' }), ['ignored'], 2026);
  assert.equal(msg, 'Yo Sam, 27th!');
});

test('buildMessage skips templates the person cannot fill', () => {
  const noYear = person({ year: null });
  for (let y = 2026; y < 2040; y++) {
    const msg = b.buildMessage(noYear, ['Happy {ordinal} {name}', 'Happy birthday {name}'], y);
    assert.equal(msg, 'Happy birthday Sam Lee');
  }
});

test('buildMessage is stable for a person+year (preview equals what is sent)', () => {
  const t = ['a {name}', 'b {name}', 'c {name}', 'd {name}'];
  assert.equal(b.buildMessage(person(), t, 2026), b.buildMessage(person(), t, 2026));
});

test('extra CSV columns become template variables', () => {
  const p = person({ extra: { nickname: 'Sammy', city: '' } });
  assert.equal(b.buildMessage(p, ['Happy bday {nickname}!', 'In {city}'], 2026), 'Happy bday Sammy!');
});

test('nextOccurrence and upcoming sort by send time', () => {
  const opts = { sendTime: '00:00', timezone: 'America/Toronto' };
  const now = new Date('2026-10-25T12:00:00Z');
  const a = person({ name: 'A', phone: '1', ...b.parseBirthday('11-02') });
  const c = person({ name: 'C', phone: '3', ...b.parseBirthday('10-26') });
  const far = person({ name: 'F', phone: '4', ...b.parseBirthday('09-01') });
  const list = b.upcoming([a, far, c], now, opts, 30);
  assert.deepEqual(list.map((x) => x.person.name), ['C', 'A']);
  assert.equal(list[0].next.daysAway, 1);
});
