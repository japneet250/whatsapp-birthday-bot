'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const csv = require('../src/csv');
const { Store, normalizePhone } = require('../src/store');

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'bday-')));

test('csv round-trips commas, quotes, newlines and emoji', () => {
  const rows = [['name', 'message'], ['Jo', 'Hi, "Jo"!\nLine two 🎂']];
  assert.deepEqual(csv.parse(csv.stringify(rows)), rows);
});

test('csv handles CRLF and BOM from Excel', () => {
  assert.deepEqual(csv.parse('﻿name,phone\r\nA,1\r\n'), [['name', 'phone'], ['A', '1']]);
});

test('normalizePhone strips formatting and 00 prefix', () => {
  assert.equal(normalizePhone('+1 (416) 555-0101'), '14165550101');
  assert.equal(normalizePhone('0044 7700 900123'), '447700900123');
});

test('add, edit, delete a person', () => {
  const s = tmpStore();
  s.upsertPerson({ name: 'Alex', phone: '+1 416 555 0101', birthday: '2000-3-14' });
  assert.equal(s.listPeople()[0].birthday, '2000-03-14');
  s.upsertPerson({ name: 'Alex K', phone: '14165550101', birthday: '03-14' }, '14165550101');
  assert.equal(s.listPeople()[0].name, 'Alex K');
  s.deletePerson('14165550101');
  assert.equal(s.listPeople().length, 0);
});

test('rejects bad rows and duplicate phones', () => {
  const s = tmpStore();
  assert.throws(() => s.upsertPerson({ name: 'X', phone: '12', birthday: '01-01' }), /country code/);
  assert.throws(() => s.upsertPerson({ name: 'X', phone: '14165550101', birthday: '02-30' }), /YYYY-MM-DD/);
  assert.throws(() => s.upsertPerson({ name: 'X', phone: '14165550101', birthday: '01-01', timezone: 'Mars/Base' }), /Timezone/);
  s.upsertPerson({ name: 'A', phone: '14165550101', birthday: '01-01' });
  assert.throws(() => s.upsertPerson({ name: 'B', phone: '14165550101', birthday: '01-02' }), /already uses/);
});

test('import merges by phone, keeps extra columns, reports bad rows', () => {
  const s = tmpStore();
  s.upsertPerson({ name: 'A', phone: '14165550101', birthday: '01-01' });
  const res = s.importCsv('name,phone,birthday,nickname\nA2,14165550101,01-01,Ace\nB,447700900123,1990-05-05,Bee\nBad,1,xx,\n');
  assert.equal(res.imported, 2);
  assert.equal(res.errors.length, 1);
  const people = s.listPeople();
  assert.equal(people.length, 2);
  assert.equal(people.find((p) => p.phone === '14165550101').name, 'A2');
  assert.match(fs.readFileSync(s.files.people, 'utf8'), /^name,phone,birthday,timezone,message,nickname/);
});

test('templates fall back to defaults and refuse to be emptied', () => {
  const s = tmpStore();
  assert.ok(s.readTemplates().length > 0);
  assert.throws(() => s.saveTemplates(['  ']), /at least one/);
});
