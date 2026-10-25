'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const state = { status: null, people: [], errors: [], templates: [], history: [], editing: null };

// ---------- api ----------
async function api(method, url, body, type = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': type } : {},
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(text, isError = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
}

// ---------- formatting ----------
function fmtTime(ms, tz) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}
function fmtDay(ms, tz) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms));
}
function fmtSendTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h, m));
}
function relDay(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}
function countdown(ms) {
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d >= 2) return `${d} days ${h} h`;
  if (d === 1) return `1 day ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${Math.max(m, 1)} min`;
}
const defaultTz = () => state.status?.timezone;

// ---------- header + link dialog ----------
function renderStatus() {
  const s = state.status;
  if (!s) return;
  const { state: wa, me, error } = s.whatsapp;
  const pill = $('#link-status');
  pill.dataset.state = wa;
  const labels = {
    ready: `Linked${me?.number ? ` to +${me.number}` : ''}`,
    qr: 'Scan to link WhatsApp',
    starting: 'Starting WhatsApp…',
    disconnected: 'WhatsApp disconnected',
    disabled: 'Sending is off',
  };
  $('.label', pill).textContent = labels[wa] || wa;

  const body = {
    ready: `Linked to ${esc(me?.name || 'your account')} (+${esc(me?.number || '')}). Messages send from this number. Your phone can be off, but open WhatsApp on it at least every couple of weeks so the link stays active.`,
    qr: 'Open WhatsApp on your phone, go to Settings, Linked devices, Link a device, then scan the code on this page.',
    starting: 'WhatsApp is starting up. This can take up to a minute after a restart.',
    disconnected: `${esc(error || 'Lost connection.')} The bot retries on its own.`,
    disabled: 'This server runs with WHATSAPP=off, so nothing will be sent. Remove that setting to start sending.',
  }[wa];
  $('#ld-body').innerHTML = body || '';
  $('#logout').hidden = wa !== 'ready';

  $('#foot').textContent =
    `Messages go out at ${fmtSendTime(s.sendTime)} in each person’s timezone. Your default timezone is ${s.timezone}. Birthday Bot v${s.version}.`;
}

// ---------- hero ----------
function heroQueue() {
  const now = Date.now();
  return state.people
    .filter((p) => p.next)
    .filter((p) => p.next.daysAway === 0 || p.next.sendAt > now)
    .sort((a, b) => a.next.sendAt - b.next.sendAt);
}

let lastHeroKey = '';
function renderHero() {
  const hero = $('#hero');
  const s = state.status;
  if (!s) return;

  if (s.whatsapp.state === 'qr' && s.whatsapp.qr) {
    hero.className = 'hero';
    hero.innerHTML = `
      <div>
        <p class="hero-kicker">One-time setup</p>
        <h1 class="hero-name">Link your WhatsApp</h1>
        <ol class="steps">
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings, then Linked devices</li>
          <li>Tap Link a device and scan this code</li>
        </ol>
        <p class="also">The code refreshes every few seconds. After linking, this page updates on its own.</p>
      </div>
      <div class="qr-box"><img src="${s.whatsapp.qr}" alt="WhatsApp link QR code"></div>`;
    lastHeroKey = 'qr';
    return;
  }

  const queue = heroQueue();
  if (!queue.length) {
    hero.className = 'hero empty-hero';
    hero.innerHTML = `
      <div>
        <p class="hero-kicker">Nobody here yet</p>
        <h1 class="hero-name">Add the first birthday</h1>
        <p class="hero-when">Add people one at a time, or import a CSV with name, phone and birthday columns.</p>
        <div class="hero-actions"><button class="btn primary" type="button" data-action="add">Add person</button></div>
      </div>
      <div class="chat"><p>Their birthday message will show up here, exactly as they will see it.</p></div>`;
    lastHeroKey = 'empty';
    return;
  }

  const p = queue[0];
  const sameDay = queue.filter((x) => x !== p && x.next.y === p.next.y && x.next.m === p.next.m && x.next.d === p.next.d);
  const later = queue.filter((x) => x !== p && !sameDay.includes(x)).slice(0, 2);
  const tz = p.next.timezone;
  const left = p.next.sendAt - Date.now();
  const isToday = p.next.daysAway === 0;

  let count;
  if (p.sent) count = `Sent at ${fmtTime(Date.parse(p.sent.at), tz)}`;
  else if (p.failure) count = `Couldn’t send yet: ${esc(p.failure.error)}. Retrying.`;
  else if (left > 0) count = `Sends in <strong>${countdown(left)}</strong>`;
  else if (s.whatsapp.state === 'ready') count = 'Sending now';
  else count = 'Due now, waiting for WhatsApp to connect';

  const turning = p.turning ? `turns ${p.turning} ${relDay(p.next.daysAway)}` : `has a birthday ${relDay(p.next.daysAway)}`;
  const tzNote = tz !== defaultTz() ? ` (${esc(tz)} time)` : '';
  const others = sameDay.length ? `<p class="also">Also that day: ${sameDay.map((x) => esc(x.name)).join(', ')}</p>` : '';
  const next = later.length ? `<p class="also">After that: ${later.map((x) => `${esc(x.name)} ${relDay(x.next.daysAway)}`).join(', ')}</p>` : '';

  const key = `${p.phone}:${p.next.y}:${p.preview}`;
  const animate = key !== lastHeroKey;
  lastHeroKey = key;

  hero.className = 'hero';
  hero.innerHTML = `
    <div>
      <p class="hero-kicker">${isToday ? 'Today' : 'Next up'}</p>
      <h1 class="hero-name">${esc(p.name)}</h1>
      <p class="hero-when">${turning}, ${esc(fmtDay(p.next.sendAt, tz))}${tzNote}</p>
      <p class="hero-count">${count}</p>
      <div class="hero-actions">
        <button class="btn" type="button" data-action="preview" data-phone="${esc(p.phone)}" ${s.whatsapp.state === 'ready' ? '' : 'disabled title="Link WhatsApp first"'}>Send preview to me</button>
        <button class="btn" type="button" data-action="edit" data-phone="${esc(p.phone)}">Edit ${esc(p.name.split(/\s+/)[0])}</button>
      </div>
      ${others}${next}
    </div>
    <div class="chat" aria-label="Message preview">
      <span class="chat-day">${isToday ? 'Today' : esc(fmtDay(p.next.sendAt, tz))}</span>
      <div class="bubble${animate ? ' enter' : ''}">${esc(p.preview)}<span class="bubble-meta">${fmtTime(p.next.sendAt, tz)}${p.sent ? '<span class="ticks" aria-label="sent">✓✓</span>' : '<span class="pending" aria-label="scheduled">🕛</span>'}</span></div>
    </div>`;
}

// ---------- calendar ----------
function renderCalendar() {
  const cal = $('#calendar');
  const thisMonth = new Date().getMonth() + 1;
  const thisYear = new Date().getFullYear();
  $('#cal-sub').textContent = state.people.length
    ? `${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}. Tap a name to edit.`
    : '';

  if (!state.people.length) {
    cal.innerHTML = `<li class="cal-empty"><p>No birthdays yet. Add someone, or import a CSV exported from Google Sheets or Excel.</p>
      <button class="btn primary" type="button" data-action="add">Add person</button></li>`;
    return;
  }

  const byMonth = Array.from({ length: 12 }, () => []);
  for (const p of state.people) {
    const [mm, dd] = p.birthday.slice(-5).split('-').map(Number);
    byMonth[mm - 1].push({ p, dd });
  }

  cal.innerHTML = byMonth.map((list, i) => {
    list.sort((a, b) => a.dd - b.dd || a.p.name.localeCompare(b.p.name));
    const items = list.map(({ p, dd }) => {
      const n = p.next;
      const today = n && n.daysAway === 0;
      const past = n && n.y > thisYear && !today;
      let tag = '';
      let cls = '';
      if (p.sent && today) { tag = 'sent ✓'; cls = 'sent'; }
      else if (p.failure && today) { tag = 'failed'; cls = 'failed'; }
      else if (today) { tag = 'today'; cls = 'today'; }
      else if (p.turning && !past) tag = `turns ${p.turning}`;
      if (past) cls += ' past';
      return `<li><button class="entry ${cls}" type="button" data-action="edit" data-phone="${esc(p.phone)}">
        <span class="d">${dd}</span><span class="n">${esc(p.name)}</span><span class="tag">${tag}</span></button></li>`;
    }).join('');
    return `<li class="month${i + 1 === thisMonth ? ' current' : ''}">
      <h3>${MONTHS[i]}${list.length ? `<small>${list.length}</small>` : ''}</h3>
      ${items ? `<ul>${items}</ul>` : '<p class="none">No birthdays</p>'}
    </li>`;
  }).join('');
}

function renderProblems() {
  const box = $('#problems');
  if (!state.errors.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<strong>${state.errors.length} row${state.errors.length === 1 ? '' : 's'} in birthdays.csv ${state.errors.length === 1 ? 'is' : 'are'} being skipped.</strong> Fix ${state.errors.length === 1 ? 'it' : 'them'} in the file or re-import.
    <ul>${state.errors.map((e) => `<li>Row ${e.row}${e.record?.name ? ` (${esc(e.record.name)})` : ''}: ${esc(e.error)}</li>`).join('')}</ul>`;
}

// ---------- templates ----------
function extraColumns() {
  const cols = new Set();
  for (const p of state.people) for (const k of Object.keys(p.extra || {})) cols.add(k);
  return [...cols];
}

function renderTemplates() {
  const extra = extraColumns();
  $('#extra-vars').innerHTML = extra.length ? `, plus your own columns: ${extra.map((c) => `<code>{${esc(c)}}</code>`).join(', ')}` : '';
  $('#templates').innerHTML = state.templates.map((t, i) => `
    <li class="tpl">
      <textarea aria-label="Message ${i + 1}" rows="2">${esc(t)}</textarea>
      <button class="btn remove" type="button" data-action="remove-template" data-i="${i}" aria-label="Remove message ${i + 1}">✕</button>
    </li>`).join('');
}

function readTemplatesFromForm() {
  return [...document.querySelectorAll('#templates textarea')].map((t) => t.value);
}

// ---------- history ----------
function renderHistory() {
  const el = $('#history');
  if (!state.history.length) {
    el.innerHTML = '<li class="hint">Nothing sent yet. Messages show up here after they go out.</li>';
    return;
  }
  el.innerHTML = state.history.slice(0, 12).map((h) => `
    <li><span class="who">${esc(h.name)}</span><span class="msg">${esc(h.message)}</span>
    <span class="when">${esc(new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span></li>`).join('');
}

function renderAll() {
  renderStatus();
  renderHero();
  renderCalendar();
  renderProblems();
  renderHistory();
}

// ---------- person dialog ----------
const dlg = $('#person-dialog');
const form = $('#person-form');

function setupDialogOptions() {
  form.month.innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  try {
    $('#tz-list').innerHTML = Intl.supportedValuesOf('timeZone').map((z) => `<option value="${z}">`).join('');
  } catch { /* older browser: free text still works */ }
}

function openPerson(phone) {
  const p = phone ? state.people.find((x) => x.phone === phone) : null;
  state.editing = p ? p.phone : null;
  form.reset();
  $('#form-error').hidden = true;
  $('#pd-title').textContent = p ? `Edit ${p.name}` : 'Add person';
  $('#delete-person').hidden = !p;

  const extra = extraColumns();
  $('#extra-fields').innerHTML = extra.map((c) => `<label>${esc(c)} <input data-extra="${esc(c)}" value="${esc(p?.extra?.[c] || '')}" autocomplete="off"></label>`).join('');

  if (p) {
    const parts = p.birthday.split('-').map(Number);
    const [y, m, d] = parts.length === 3 ? parts : [null, ...parts];
    form.name.value = p.name;
    form.phone.value = `+${p.phone}`;
    form.month.value = m;
    form.day.value = d;
    form.year.value = y || '';
    form.timezone.value = p.timezone || '';
    form.message.value = p.message || '';
  }
  dlg.showModal();
  form.name.focus();
}

function personFromForm() {
  const pad = (n) => String(n).padStart(2, '0');
  const y = form.year.value.trim();
  const md = `${pad(form.month.value)}-${pad(form.day.value)}`;
  const body = {
    name: form.name.value,
    phone: form.phone.value,
    birthday: y ? `${y}-${md}` : md,
    timezone: form.timezone.value.trim(),
    message: form.message.value,
  };
  for (const input of document.querySelectorAll('[data-extra]')) body[input.dataset.extra] = input.value;
  return body;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#save-person');
  btn.disabled = true;
  try {
    const body = personFromForm();
    if (state.editing) await api('PUT', `/api/people/${state.editing}`, body);
    else await api('POST', '/api/people', body);
    dlg.close();
    toast(state.editing ? `Saved ${body.name}` : `Added ${body.name}`);
    await loadPeople();
  } catch (err) {
    $('#form-error').textContent = err.message;
    $('#form-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#cancel-person').addEventListener('click', () => dlg.close());

$('#delete-person').addEventListener('click', async () => {
  const p = state.people.find((x) => x.phone === state.editing);
  if (!p || !window.confirm(`Delete ${p.name}? They won’t get a birthday message.`)) return;
  try {
    await api('DELETE', `/api/people/${p.phone}`);
    dlg.close();
    toast(`Deleted ${p.name}`);
    await loadPeople();
  } catch (err) { toast(err.message, true); }
});

// ---------- other actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, phone } = el.dataset;
  if (action === 'add') openPerson(null);
  if (action === 'edit') openPerson(phone);
  if (action === 'remove-template') {
    state.templates = readTemplatesFromForm().filter((_, i) => i !== Number(el.dataset.i));
    renderTemplates();
  }
  if (action === 'preview') {
    el.disabled = true;
    try {
      await api('POST', `/api/preview-to-me/${phone}`);
      toast('Preview sent to your own WhatsApp chat');
    } catch (err) { toast(err.message, true); }
    el.disabled = false;
  }
});

$('#add-person').addEventListener('click', () => openPerson(null));

$('#add-template').addEventListener('click', () => {
  state.templates = [...readTemplatesFromForm(), ''];
  renderTemplates();
  const all = document.querySelectorAll('#templates textarea');
  all[all.length - 1].focus();
});

$('#templates-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { templates } = await api('PUT', '/api/templates', { templates: readTemplatesFromForm() });
    state.templates = templates;
    renderTemplates();
    toast('Messages saved');
    await loadPeople();
  } catch (err) { toast(err.message, true); }
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const res = await api('POST', '/api/import?mode=merge', await file.text(), 'text/csv');
    const skipped = res.errors.length ? `, ${res.errors.length} skipped: ${res.errors.slice(0, 2).map((x) => `row ${x.row} ${x.error}`).join('; ')}` : '';
    toast(`Imported ${res.imported}${skipped}`, res.errors.length > 0);
    await loadPeople();
  } catch (err) { toast(err.message, true); }
  e.target.value = '';
});

$('#link-status').addEventListener('click', () => $('#link-dialog').showModal());

$('#logout').addEventListener('click', async () => {
  if (!window.confirm('Unlink this server from your WhatsApp? You’ll need to scan a new QR code.')) return;
  try {
    await api('POST', '/api/logout');
    $('#link-dialog').close();
    toast('Unlinked. Scan the new code to link again.');
  } catch (err) { toast(err.message, true); }
});

// ---------- loading + polling ----------
async function loadStatus() {
  state.status = await api('GET', '/api/status');
}
async function loadPeople() {
  const [{ people, errors }, history] = await Promise.all([api('GET', '/api/people'), api('GET', '/api/history')]);
  state.people = people;
  state.errors = errors;
  state.history = history;
  renderAll();
  if (!$('#templates').children.length) renderTemplates();
}

async function boot() {
  setupDialogOptions();
  try {
    await loadStatus();
    const { templates } = await api('GET', '/api/templates');
    state.templates = templates;
    await loadPeople();
    renderTemplates();
  } catch (err) {
    toast(`Could not load: ${err.message}`, true);
  }

  // Poll status quickly while linking, slowly once linked.
  let prev = state.status?.whatsapp.state;
  const pollStatus = async () => {
    try {
      await loadStatus();
      const now = state.status.whatsapp.state;
      if (now !== prev || now === 'qr') { renderStatus(); renderHero(); }
      if (now !== prev && now === 'ready') toast('WhatsApp linked');
      prev = now;
    } catch { /* offline for a moment */ }
    setTimeout(pollStatus, ['qr', 'starting'].includes(prev) ? 3000 : 20000);
  };
  setTimeout(pollStatus, 3000);
  setInterval(() => loadPeople().catch(() => {}), 60000);
  setInterval(renderHero, 30000);
}

boot();
