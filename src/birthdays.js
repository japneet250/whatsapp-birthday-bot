'use strict';

// Pure date + message logic. No I/O, so it is easy to test.

const DAY_MS = 86400000;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "1999-10-26" or "10-26" -> { year, month, day } | null */
function parseBirthday(str) {
  const match = String(str || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = match[1] ? Number(match[1]) : null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const max = month === 2 ? (year && !isLeap(year) ? 28 : 29) : daysInMonth(2001, month);
  if (day > max) return null;
  return { year, month, day };
}

/** Wall-clock parts of an instant in a timezone. */
function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, hh: out.hour, mm: out.minute, ss: out.second };
}

/** The instant (ms) at which the wall clock in `timeZone` reads y-m-d hh:mm. */
function zonedTimeToUtc(y, m, d, hh, mm, timeZone) {
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const diff = target - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** Is a person's birthday on calendar date {y,m,d}? Feb 29 -> Feb 28 in non-leap years. */
function isBirthdayOn(person, { y, m, d }) {
  if (person.month === 2 && person.day === 29 && !isLeap(y)) return m === 2 && d === 28;
  return person.month === m && person.day === d;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

/** Stable small hash, so the preview you see is exactly what gets sent. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BUILT_IN_FIELDS = new Set(['name', 'phone', 'birthday', 'timezone', 'message']);

/** Variables available in templates: {name} {first} {age} {ordinal} + any extra CSV column. */
function templateVars(person, year) {
  const age = person.year ? year - person.year : null;
  const vars = {
    name: person.name,
    first: person.name.split(/\s+/)[0],
    age: age ?? '',
    ordinal: age ? ordinal(age) : '',
  };
  for (const [key, value] of Object.entries(person.extra || {})) {
    if (!BUILT_IN_FIELDS.has(key) && !(key in vars)) vars[key] = value;
  }
  return vars;
}

function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

/** Template placeholders this person cannot fill (e.g. {age} without a birth year, or an empty column). */
function missingVars(template, vars) {
  const missing = [];
  for (const [, key] of template.matchAll(/\{(\w+)\}/g)) {
    if (!(key in vars) || vars[key] === '' || vars[key] == null) missing.push(key);
  }
  return missing;
}

function buildMessage(person, templates, year) {
  const vars = templateVars(person, year);
  if (person.message) return render(person.message, vars);
  const usable = templates.filter((t) => missingVars(t, vars).length === 0);
  const pool = usable.length ? usable : ['Happy birthday {name}! 🎉🎂'];
  return render(pool[hash(`${person.phone}:${year}`) % pool.length], vars);
}

/** Next time this person's message is due, from `now`, in their timezone. */
function nextOccurrence(person, now, { sendTime, timezone }) {
  const tz = person.timezone || timezone;
  const [sh, sm] = sendTime.split(':').map(Number);
  const today = localParts(now, tz);
  for (let offset = 0; offset <= 366; offset++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d) + offset * DAY_MS);
    const date = { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate() };
    if (!isBirthdayOn(person, date)) continue;
    const sendAt = zonedTimeToUtc(date.y, date.m, date.d, sh, sm, tz);
    // Today's birthday still counts if send time has passed (it is due now / was sent).
    return { ...date, daysAway: offset, sendAt, timezone: tz };
  }
  return null;
}

/** Is a message due right now? Due = it is their birthday in their timezone and we are past send time. */
function isDue(person, now, { sendTime, timezone }) {
  const tz = person.timezone || timezone;
  const p = localParts(now, tz);
  if (!isBirthdayOn(person, p)) return null;
  const nowHM = p.hh * 60 + p.mm;
  const [sh, sm] = sendTime.split(':').map(Number);
  if (nowHM < sh * 60 + sm) return null;
  return { year: p.y, key: `${person.phone}:${p.y}` };
}

function upcoming(people, now, opts, days = 30) {
  return people
    .map((person) => ({ person, next: nextOccurrence(person, now, opts) }))
    .filter((x) => x.next && x.next.daysAway <= days)
    .sort((a, b) => a.next.sendAt - b.next.sendAt);
}

module.exports = {
  parseBirthday,
  localParts,
  zonedTimeToUtc,
  isBirthdayOn,
  isLeap,
  ordinal,
  templateVars,
  render,
  missingVars,
  buildMessage,
  nextOccurrence,
  isDue,
  upcoming,
};
