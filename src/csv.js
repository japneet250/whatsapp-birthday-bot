'use strict';

// Small RFC 4180-style CSV reader/writer: quoted fields, escaped quotes, newlines inside quotes.

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function escape(value) {
  const v = value == null ? '' : String(value);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function stringify(rows) {
  return rows.map((r) => r.map(escape).join(',')).join('\n') + '\n';
}

/** CSV text -> array of objects keyed by lower-cased header. */
function toObjects(text) {
  const rows = parse(text);
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
  return { header, records };
}

function fromObjects(header, records) {
  return stringify([header, ...records.map((r) => header.map((h) => r[h] ?? ''))]);
}

module.exports = { parse, stringify, toObjects, fromObjects };
