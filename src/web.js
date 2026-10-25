'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { nextOccurrence, buildMessage, upcoming } = require('./birthdays');
const pkg = require('../package.json');

function basicAuth(password) {
  const expected = Buffer.from(password);
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Birthday Bot", charset="UTF-8"');
    res.status(401).send('Enter any username and your dashboard password.');
  };
}

function fontDir(pkgName) {
  return path.dirname(require.resolve(`${pkgName}/package.json`));
}

function createApp({ store, whatsapp, scheduler, config, password, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (req, res) => res.json({ ok: true, whatsapp: whatsapp.status().state }));

  if (password) app.use(basicAuth(password));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
  app.use('/fonts/gabarito', express.static(fontDir('@fontsource/gabarito'), { maxAge: '30d' }));
  app.use('/fonts/atkinson', express.static(fontDir('@fontsource/atkinson-hyperlegible'), { maxAge: '30d' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const opts = { sendTime: config.sendTime, timezone: config.timezone };

  function describe(person, templates, sent, at) {
    const next = nextOccurrence(person, at, opts);
    const key = next ? `${person.phone}:${next.y}` : null;
    return {
      name: person.name,
      phone: person.phone,
      birthday: person.birthday,
      timezone: person.timezone,
      message: person.message,
      extra: person.extra,
      next,
      turning: person.year && next ? next.y - person.year : null,
      preview: next ? buildMessage(person, templates, next.y) : null,
      sent: key && sent[key] ? sent[key] : null,
      failure: scheduler ? scheduler.failuresFor(person.phone) : null,
    };
  }

  app.get('/api/status', (req, res) => {
    res.json({
      version: pkg.version,
      whatsapp: whatsapp.status(),
      timezone: config.timezone,
      sendTime: config.sendTime,
      now: now().toISOString(),
    });
  });

  app.get('/api/people', (req, res) => {
    const { people, errors } = store.readPeople();
    const templates = store.readTemplates();
    const sent = store.readSent();
    const at = now();
    res.json({ people: people.map((p) => describe(p, templates, sent, at)), errors });
  });

  app.get('/api/upcoming', (req, res) => {
    const days = Math.min(Number(req.query.days) || config.upcomingDays, 366);
    const templates = store.readTemplates();
    const sent = store.readSent();
    const at = now();
    res.json(upcoming(store.listPeople(), at, opts, days).map(({ person }) => describe(person, templates, sent, at)));
  });

  app.post('/api/people', (req, res) => {
    res.status(201).json(store.upsertPerson(req.body || {}));
  });

  app.put('/api/people/:phone', (req, res) => {
    res.json(store.upsertPerson(req.body || {}, req.params.phone));
  });

  app.delete('/api/people/:phone', (req, res) => {
    store.deletePerson(req.params.phone);
    res.status(204).end();
  });

  app.get('/api/templates', (req, res) => res.json({ templates: store.readTemplates() }));

  app.put('/api/templates', (req, res) => {
    res.json({ templates: store.saveTemplates((req.body && req.body.templates) || []) });
  });

  app.get('/api/export.csv', (req, res) => {
    res.type('text/csv').attachment('birthdays.csv').send(store.exportCsv());
  });

  app.post('/api/import', (req, res) => {
    const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
    if (typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ error: 'Send the CSV as the request body (Content-Type: text/csv)' });
    }
    res.json(store.importCsv(req.body, mode));
  });

  app.get('/api/history', (req, res) => {
    const entries = Object.entries(store.readSent())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 50);
    res.json(entries);
  });

  // Sends the exact message a person will get to YOUR own chat, so you can check it on your phone.
  app.post('/api/preview-to-me/:phone', async (req, res) => {
    const person = store.listPeople().find((p) => p.phone === req.params.phone);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const next = nextOccurrence(person, now(), opts);
    const text = buildMessage(person, store.readTemplates(), next.y);
    await whatsapp.sendToSelf(`Preview of ${person.name}'s birthday message:\n\n${text}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', async (req, res) => {
    await whatsapp.logout();
    res.json({ ok: true });
  });

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
