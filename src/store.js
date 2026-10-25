'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('./csv');
const { parseBirthday } = require('./birthdays');
const { isValidTimezone } = require('./config');

const CORE_COLUMNS = ['name', 'phone', 'birthday', 'timezone', 'message'];

const DEFAULT_TEMPLATES = [
  'Happy birthday {first}! 🎉🎂 Hope today is amazing!',
  'HAPPY BIRTHDAY {first}!!! 🥳🎈 Wishing you the best year yet!',
  'Happy birthday {first}! 🎁✨ Hope you get spoiled today!',
  '{first}!! It’s your day 🎂🎉 Have an incredible one!',
  'Happy birthday {first} 🥂🎊 Cheers to another great year!',
  'Happy {ordinal} birthday {first}! 🎉🎂 Hope it’s a great one!',
];

/** Turn "+1 (416) 555-0101" into "14165550101". Leading 00 international prefix is dropped. */
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '').replace(/^00/, '');
}

/** Validate + normalise one raw record. Returns { person } or { error }. */
function toPerson(record) {
  const name = (record.name || '').trim();
  const phone = normalizePhone(record.phone);
  const bd = parseBirthday(record.birthday);
  const timezone = (record.timezone || '').trim();

  if (!name) return { error: 'Name is required' };
  if (phone.length < 8 || phone.length > 15) return { error: `Phone "${record.phone}" needs a country code and 8–15 digits, e.g. 14165550101` };
  if (!bd) return { error: `Birthday "${record.birthday}" must be YYYY-MM-DD or MM-DD` };
  if (timezone && !isValidTimezone(timezone)) return { error: `Timezone "${timezone}" is not valid. Use an IANA name like Europe/London` };

  const extra = {};
  for (const [k, v] of Object.entries(record)) if (!CORE_COLUMNS.includes(k)) extra[k] = v;

  const birthday = bd.year
    ? `${bd.year}-${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`
    : `${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`;

  return {
    person: { name, phone, birthday, ...bd, timezone, message: (record.message || '').trim(), extra },
  };
}

function personToRecord(p) {
  return { name: p.name, phone: p.phone, birthday: p.birthday, timezone: p.timezone || '', message: p.message || '', ...p.extra };
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.files = {
      people: path.join(dataDir, 'birthdays.csv'),
      templates: path.join(dataDir, 'messages.json'),
      sent: path.join(dataDir, 'sent.json'),
    };
    if (!fs.existsSync(this.files.people)) fs.writeFileSync(this.files.people, CORE_COLUMNS.join(',') + '\n');
    if (!fs.existsSync(this.files.templates)) this.saveTemplates(DEFAULT_TEMPLATES);
  }

  // ---- people (birthdays.csv is the source of truth; re-read every time so hand edits are picked up) ----

  readPeople() {
    const { header, records } = csv.toObjects(fs.readFileSync(this.files.people, 'utf8'));
    const people = [];
    const errors = [];
    records.forEach((r, i) => {
      const { person, error } = toPerson(r);
      if (error) errors.push({ row: i + 2, error, record: r });
      else people.push(person);
    });
    return { header, people, errors };
  }

  listPeople() {
    return this.readPeople().people;
  }

  writePeople(people, header) {
    const extraCols = new Set();
    for (const p of people) for (const k of Object.keys(p.extra || {})) extraCols.add(k);
    const cols = [...CORE_COLUMNS];
    for (const h of header || []) if (!cols.includes(h)) cols.push(h);
    for (const k of extraCols) if (!cols.includes(k)) cols.push(k);
    const tmp = this.files.people + '.tmp';
    fs.writeFileSync(tmp, csv.fromObjects(cols, people.map(personToRecord)));
    fs.renameSync(tmp, this.files.people);
  }

  upsertPerson(record, originalPhone) {
    const { person, error } = toPerson(record);
    if (error) throw Object.assign(new Error(error), { status: 400 });
    const { header, people } = this.readPeople();
    const key = originalPhone ? normalizePhone(originalPhone) : null;
    const clash = people.find((p) => p.phone === person.phone && p.phone !== key);
    if (clash) throw Object.assign(new Error(`${clash.name} already uses +${person.phone}`), { status: 409 });
    const idx = key ? people.findIndex((p) => p.phone === key) : -1;
    if (key && idx === -1) throw Object.assign(new Error('Person not found'), { status: 404 });
    const saved = idx >= 0 ? { ...person, extra: { ...people[idx].extra, ...person.extra } } : person;
    if (idx >= 0) people[idx] = saved;
    else people.push(saved);
    this.writePeople(people, header);
    return saved;
  }

  deletePerson(phone) {
    const { header, people } = this.readPeople();
    const key = normalizePhone(phone);
    const next = people.filter((p) => p.phone !== key);
    if (next.length === people.length) throw Object.assign(new Error('Person not found'), { status: 404 });
    this.writePeople(next, header);
  }

  exportCsv() {
    return fs.readFileSync(this.files.people, 'utf8');
  }

  /** mode "merge" adds/updates by phone; "replace" swaps the whole list. Bad rows are reported, not written. */
  importCsv(text, mode = 'merge') {
    const { header, records } = csv.toObjects(text);
    for (const col of ['name', 'phone', 'birthday']) {
      if (!header.includes(col)) throw Object.assign(new Error(`CSV needs a "${col}" column`), { status: 400 });
    }
    const incoming = [];
    const errors = [];
    records.forEach((r, i) => {
      const { person, error } = toPerson(r);
      if (error) errors.push({ row: i + 2, error });
      else incoming.push(person);
    });
    const current = mode === 'replace' ? [] : this.readPeople().people;
    const byPhone = new Map(current.map((p) => [p.phone, p]));
    for (const p of incoming) byPhone.set(p.phone, p);
    this.writePeople([...byPhone.values()], header);
    return { imported: incoming.length, errors };
  }

  // ---- templates ----

  readTemplates() {
    try {
      const { templates } = JSON.parse(fs.readFileSync(this.files.templates, 'utf8'));
      return Array.isArray(templates) && templates.length ? templates : DEFAULT_TEMPLATES;
    } catch {
      return DEFAULT_TEMPLATES;
    }
  }

  saveTemplates(templates) {
    const clean = templates.map((t) => String(t).trim()).filter(Boolean);
    if (!clean.length) throw Object.assign(new Error('Keep at least one message template'), { status: 400 });
    fs.writeFileSync(this.files.templates, JSON.stringify({ templates: clean }, null, 2) + '\n');
    return clean;
  }

  // ---- sent log (prevents duplicates, powers "recently sent") ----

  readSent() {
    try {
      return JSON.parse(fs.readFileSync(this.files.sent, 'utf8'));
    } catch {
      return {};
    }
  }

  markSent(key, entry) {
    const sent = this.readSent();
    sent[key] = entry;
    const tmp = this.files.sent + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sent, null, 2));
    fs.renameSync(tmp, this.files.sent);
  }
}

module.exports = { Store, toPerson, normalizePhone, DEFAULT_TEMPLATES, CORE_COLUMNS };
