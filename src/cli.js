#!/usr/bin/env node
'use strict';

// Offline helpers. Nothing here touches WhatsApp.
//   node src/cli.js preview [days]   who's coming up and the exact message they'll get
//   node src/cli.js check            validate birthdays.csv and templates

const config = require('./config').load();
const { Store } = require('./store');
const { upcoming, buildMessage, missingVars, templateVars } = require('./birthdays');

const store = new Store(config.dataDir);
const [cmd = 'preview', arg] = process.argv.slice(2);
const opts = { sendTime: config.sendTime, timezone: config.timezone };

function fmt(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
}

if (cmd === 'preview') {
  const days = Number(arg) || config.upcomingDays;
  const list = upcoming(store.listPeople(), new Date(), opts, days);
  const templates = store.readTemplates();
  if (!list.length) console.log(`Nobody in the next ${days} days.`);
  for (const { person, next } of list) {
    const when = next.daysAway === 0 ? 'today' : next.daysAway === 1 ? 'tomorrow' : `in ${next.daysAway} days`;
    console.log(`${person.name} (+${person.phone}) ${when}, sends ${fmt(next.sendAt, next.timezone)} ${next.timezone}`);
    console.log(`  ${buildMessage(person, templates, next.y).replace(/\n/g, '\n  ')}\n`);
  }
} else if (cmd === 'check') {
  const { people, errors } = store.readPeople();
  console.log(`${people.length} valid row(s) in ${store.files.people}`);
  for (const e of errors) console.log(`  Row ${e.row}: ${e.error}`);
  const templates = store.readTemplates();
  const sample = people[0];
  if (sample) {
    const vars = templateVars(sample, new Date().getFullYear());
    for (const t of templates) {
      const unknown = missingVars(t, { ...vars, age: 1, ordinal: '1st' }).filter((k) => !(k in vars));
      if (unknown.length) console.log(`  Template uses unknown {${unknown.join('}, {')}}: "${t}"`);
    }
  }
  process.exitCode = errors.length ? 1 : 0;
} else {
  console.log('Usage: birthday-bot preview [days] | check');
  process.exitCode = 1;
}
