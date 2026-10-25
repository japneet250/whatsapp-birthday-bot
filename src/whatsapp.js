'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

/**
 * Thin wrapper around whatsapp-web.js that tracks connection state for the dashboard.
 * States: disabled | starting | qr | ready | disconnected
 */
class WhatsApp {
  constructor({ config, log = console }) {
    this.config = config;
    this.log = log;
    this.state = config.whatsappEnabled ? 'starting' : 'disabled';
    this.qrDataUrl = null;
    this.me = null;
    this.lastError = null;
    this.client = null;
    this.sessionDir = path.join(config.dataDir, 'session');
  }

  isReady() {
    return this.state === 'ready';
  }

  status() {
    return { state: this.state, qr: this.state === 'qr' ? this.qrDataUrl : null, me: this.me, error: this.lastError };
  }

  // Chromium leaves lock files behind if the container is killed; they block the next start.
  clearStaleLocks() {
    const dir = path.join(this.sessionDir, 'session');
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* ignore */ }
    }
  }

  async start() {
    if (!this.config.whatsappEnabled) {
      this.log.info('WhatsApp is off. Dashboard only, nothing will be sent.');
      return;
    }
    const { Client, LocalAuth } = require('whatsapp-web.js');
    this.clearStaleLocks();
    this.state = 'starting';

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.sessionDir }),
      puppeteer: {
        headless: true,
        executablePath: this.config.chromiumPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
      },
    });
    this.client = client;

    client.on('qr', async (qr) => {
      this.state = 'qr';
      this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      this.log.info('Scan to link WhatsApp (or open the dashboard): WhatsApp > Settings > Linked devices > Link a device');
      qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
      this.state = 'starting';
      this.qrDataUrl = null;
      this.log.info('WhatsApp authenticated');
    });

    client.on('auth_failure', (msg) => {
      this.lastError = `Login failed: ${msg}`;
      this.log.error(this.lastError);
    });

    client.on('ready', () => {
      this.state = 'ready';
      this.lastError = null;
      const info = client.info || {};
      this.me = { name: info.pushname || null, number: info.wid ? info.wid.user : null };
      this.log.info(`WhatsApp ready as ${this.me.name || ''} +${this.me.number || '?'}`);
    });

    client.on('disconnected', (reason) => {
      this.state = 'disconnected';
      this.me = null;
      this.lastError = `Disconnected: ${reason}`;
      this.log.error(this.lastError + '. Restarting in 5s.');
      this.restart(5000);
    });

    try {
      await client.initialize();
    } catch (err) {
      this.state = 'disconnected';
      this.lastError = `Could not start WhatsApp: ${err.message}`;
      this.log.error(this.lastError + '. Retrying in 30s.');
      this.restart(30000);
    }
  }

  restart(delayMs) {
    const old = this.client;
    this.client = null;
    setTimeout(async () => {
      try { if (old) await old.destroy(); } catch { /* already gone */ }
      this.start();
    }, delayMs);
  }

  async send(phone, text) {
    if (!this.isReady()) throw new Error('WhatsApp is not connected');
    const id = await this.client.getNumberId(phone);
    if (!id) throw new Error(`+${phone} is not on WhatsApp`);
    await this.client.sendMessage(id._serialized, text);
  }

  async sendToSelf(text) {
    if (!this.isReady() || !this.me?.number) throw new Error('WhatsApp is not connected');
    return this.send(this.me.number, text);
  }

  async logout() {
    if (!this.client) return;
    await this.client.logout();
  }
}

module.exports = { WhatsApp };
