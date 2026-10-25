#!/usr/bin/env node
'use strict';

const config = require('./config').load();
const { resolvePassword } = require('./config');
const { Store } = require('./store');
const { WhatsApp } = require('./whatsapp');
const { Scheduler } = require('./scheduler');
const { createApp } = require('./web');

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = {
  info: (...a) => console.log(stamp(), ...a),
  error: (...a) => console.error(stamp(), ...a),
};

const store = new Store(config.dataDir);
const whatsapp = new WhatsApp({ config, log });
const scheduler = new Scheduler({ store, whatsapp, config, log });
const { password, generated } = resolvePassword(config);
const app = createApp({ store, whatsapp, scheduler, config, password });

const { people, errors } = store.readPeople();
log.info(`Loaded ${people.length} birthday(s) from ${store.files.people}`);
for (const e of errors) log.error(`birthdays.csv row ${e.row} skipped: ${e.error}`);
log.info(`Messages go out at ${config.sendTime} in each person's timezone (default ${config.timezone})`);

const server = app.listen(config.port, config.host, () => {
  log.info(`Dashboard on http://localhost:${config.port}`);
  if (generated) log.info(`Dashboard password: ${password}  (set DASHBOARD_PASSWORD to choose your own)`);
});

whatsapp.start();
scheduler.start();

function shutdown(signal) {
  log.info(`${signal} received, shutting down`);
  scheduler.stop();
  server.close();
  Promise.resolve(whatsapp.client && whatsapp.client.destroy())
    .catch(() => {})
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
