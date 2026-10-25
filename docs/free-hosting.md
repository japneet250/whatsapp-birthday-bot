# Host it for free

The bot needs a machine that is always on, has about 1 GB of free memory for Chromium, and keeps its files between restarts. Free "web app" tiers (Render, Koyeb and similar) don't fit: they sleep when idle and wipe the disk, which would log you out of WhatsApp every time.

Two free options work well:

| | Oracle Cloud Always Free | Google Cloud free tier |
|---|---|---|
| Server | Ampere ARM, you pick 1 OCPU + 2 GB RAM | e2-micro, 1 GB RAM (the installer adds swap) |
| Regions | Any, including Toronto and Montreal | us-west1, us-central1, us-east1 only |
| Catch | Popular regions sometimes say "out of capacity" when creating the server. Idle servers can be reclaimed (see below). | Tight on memory. Needs a billing account. |

Both ask for a credit card to verify your identity. Free-tier resources aren't charged.

Free tiers change. Check [Oracle's Always Free list](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) before you start.

## Oracle Cloud (recommended)

### 1. Create the account

Sign up at <https://www.oracle.com/cloud/free/>. When it asks for a **home region**, pick the one closest to you (for example Canada Southeast (Toronto)). Free servers can only be created in your home region, and you can't change it later.

### 2. Create the server

In the console, go to **Compute → Instances → Create instance**.

- **Image:** click *Change image* and pick **Canonical Ubuntu 24.04**.
- **Shape:** click *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, then set **1 OCPU** and **2 GB memory**.
  Don't give it more memory. Oracle reclaims free servers that stay under 20% CPU, network *and* memory use for a week. The bot uses little CPU, so its memory needs to stay above 20%, and on 2 GB it does.
- **Networking:** keep the defaults (a public subnet, with a public IPv4 address assigned).
- **SSH keys:** choose *Generate a key pair for me* and **download the private key**. You need it to log in.

Click **Create**. If you get *Out of capacity*, try another availability domain, try again later, or use the **VM.Standard.E2.1.Micro** shape (AMD, 1 GB, also free).

### 3. Open the web ports

On the instance page, click the **subnet** → its **security list** → **Add ingress rules**. Add two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

### 4. Log in and install

Copy the server's **public IP address** from the instance page. Then, in a terminal (PowerShell on Windows):

```bash
ssh -i path/to/the-key-you-downloaded.key ubuntu@YOUR_SERVER_IP
```

On macOS or Linux, run `chmod 600 path/to/the-key-you-downloaded.key` first if SSH complains about permissions.

Once you're in, run the installer with your own timezone:

```bash
curl -fsSL https://raw.githubusercontent.com/japneet250/whatsapp-birthday-bot/main/deploy/setup-vps.sh | TIMEZONE=America/Toronto bash
```

It adds swap if needed, installs Docker, opens the server's firewall, generates a dashboard password, and starts the bot behind HTTPS. The first build takes a few minutes. At the end it prints something like:

```
Dashboard:  https://129-153-1-2.sslip.io
Username:   anything
Password:   C3iBxNQ7ptngPAqB
```

### 5. Link WhatsApp

Open that address on any device, sign in, and scan the QR code from your phone: **WhatsApp → Settings → Linked devices → Link a device**. Then add your people or import a CSV. That's it.

### Keeping it free and running

- **Idle reclaim.** On the 1 OCPU / 2 GB size, the bot's memory use keeps the server from looking idle. Many people also upgrade their Oracle account to *Pay As You Go*, which is widely reported to stop idle reclaiming while still costing $0 inside the free limits. It also means anything beyond the free limits would be billed, so keep to the free shapes.
- **Updating.** SSH in and run the same install command again. Your people, messages, password and WhatsApp login are kept.
- **Backups.** Everything lives in the Docker volume. `sudo docker run --rm -v whatsapp-birthday-bot_bot-data:/data -v "$PWD":/backup alpine tar czf /backup/bot-backup.tgz -C /data .` creates `bot-backup.tgz` in the current folder.

## Google Cloud

1. Create a project with billing enabled at <https://console.cloud.google.com>.
2. **Compute Engine → VM instances → Create instance**:
   - Region **us-west1**, **us-central1** or **us-east1** (only these are free)
   - Machine type **e2-micro**
   - Boot disk: **Ubuntu 24.04**, **Standard persistent disk**, 30 GB
   - Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**
3. Click **SSH** on the instance to open a terminal in your browser, then run the same install command as in Oracle step 4.

Keep an eye on the Billing page for the first few days to confirm it shows $0.

## A computer at home

Any always-on Linux box works: a Raspberry Pi 4 or 5, an old laptop, a home server. On Raspberry Pi OS (64-bit), Ubuntu or Debian:

```bash
curl -fsSL https://raw.githubusercontent.com/japneet250/whatsapp-birthday-bot/main/deploy/setup-vps.sh | NO_HTTPS=1 TIMEZONE=America/Toronto bash
```

Then open `http://<the-computer's-local-IP>:3000` from any device on your Wi-Fi.
