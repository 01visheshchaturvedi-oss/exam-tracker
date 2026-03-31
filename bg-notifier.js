// ─────────────────────────────────────────────────────────────────────────────
// ExamRigor Background Notifier  v2
// - Fires 4-hour study check-in alerts
// - Fires task reminders (synced from app) even when browser is closed
// - Fires beep + Windows toast notification for every alarm
// - Exposes a tiny HTTP server on port 3001 so the app can push reminder data
// ─────────────────────────────────────────────────────────────────────────────

const { exec }  = require('child_process');
const fs        = require('fs');
const path      = require('path');
const http      = require('http');
require('dotenv').config();
const fetch     = require('node-fetch');

// ── Config ────────────────────────────────────────────────────────────────────
const INTERVAL_HOURS  = 4;
const INTERVAL_MS     = INTERVAL_HOURS * 60 * 60 * 1000;
const LOG_FILE        = path.join(__dirname, 'bg-notifier.log');
const REMINDERS_FILE  = path.join(__dirname, 'bg-reminders.json');
const HTTP_PORT       = 3001;

// In-memory reminder store (also persisted to bg-reminders.json)
let reminders = [];
// Track which reminders already fired today: key = "task_id-HH:MM-DateString"
const firedToday = new Set();

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleString('en-IN')}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ── Load persisted reminders on startup ───────────────────────────────────────
function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
      log(`Loaded ${reminders.length} reminder(s) from disk`);
    }
  } catch (e) {
    log(`Could not load reminders file: ${e.message}`);
  }
}

function saveRemindersToDisk() {
  try { fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8'); }
  catch (e) { log(`Could not save reminders: ${e.message}`); }
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) log(`Telegram error: ${res.status}`);
  } catch (e) { log(`Telegram failed: ${e.message}`); }
}

// ── Beep ──────────────────────────────────────────────────────────────────────
function playBeep(times = 3) {
  const beepCmds = Array.from({ length: times }, (_, i) =>
    `[console]::Beep(880, 400); Start-Sleep -Milliseconds ${i < times - 1 ? 300 : 0}`
  ).join('; ');
  const ps = `powershell -NoProfile -NonInteractive -Command "${beepCmds}"`;
  exec(ps, (err) => {
    if (err) {
      exec('mshta vbscript:Execute("Beep:window.close")', () => {});
      log('Beep via mshta fallback');
    }
  });
}

// ── Windows Toast Notification ────────────────────────────────────────────────
function showNotification(title, message, urgent = false) {
  const audio = urgent
    ? 'ms-winsoundevent:Notification.Looping.Alarm'
    : 'ms-winsoundevent:Notification.Default';
  const safeTitle   = title.replace(/"/g, '\\"').replace(/'/g, "''");
  const safeMessage = message.replace(/"/g, '\\"').replace(/'/g, "''");
  const psScript = `
$AppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = @"
<toast duration="long">
  <visual>
    <binding template="ToastGeneric">
      <text>${safeTitle}</text>
      <text>${safeMessage}</text>
    </binding>
  </visual>
  <audio src="${audio}" loop="false"/>
</toast>
"@
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.loadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Information
  $notify.BalloonTipTitle = "${safeTitle}"
  $notify.BalloonTipText  = "${safeMessage}"
  $notify.Visible = $true
  $notify.ShowBalloonTip(10000)
  Start-Sleep -Seconds 12
  $notify.Visible = $false
  $notify.Dispose()
}`.trim();
  const tmpFile = path.join(require('os').tmpdir(), 'examrigor_notify.ps1');
  try {
    fs.writeFileSync(tmpFile, psScript, 'utf8');
    exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`, (err) => {
      if (err) log(`Notification error: ${err.message}`);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    });
  } catch (err) { log(`Failed to write PS script: ${err.message}`); }
}

// ── Reminder Checker — runs every 30 seconds ──────────────────────────────────
function checkReminders() {
  if (!reminders || reminders.length === 0) return;
  const now     = new Date();
  const hhmm    = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const dateStr = now.toDateString();

  reminders.filter(r => r.enabled && r.time === hhmm).forEach(r => {
    const key = `${r.task_id}-${hhmm}-${dateStr}`;
    if (!firedToday.has(key)) {
      firedToday.add(key);
      log(`Reminder fired: ${r.task_name} at ${hhmm}`);
      playBeep(3);
      sendTelegram(`⏰ ExamRigor Reminder: Time to start "${r.task_name}" (${hhmm})`);
      setTimeout(() => showNotification(
        `⏰ Reminder: ${r.task_name}`,
        `It's ${hhmm} — time to start "${r.task_name}"`,
        true
      ), 800);
    }
  });
}

// ── 4-Hour Study Alert ────────────────────────────────────────────────────────
function triggerStudyAlert() {
  const now   = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  const title = '⏰ ExamRigor — 4-Hour Check';
  const msg   = `It's ${now}. You've been at it for ${INTERVAL_HOURS} hours.\nTake a short break, hydrate, then get back!`;
  log(`ALERT: 4-hour interval fired`);
  playBeep(3);
  sendTelegram('🔔 ExamRigor Alert: 4-hour interval beep');
  setTimeout(() => showNotification(title, msg, true), 800);
}

// ── HTTP Server — receives reminder sync from the React app ───────────────────
function startHttpServer() {
  const server = http.createServer((req, res) => {
    // CORS so the browser app can POST from localhost:3002
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'POST' && req.url === '/reminders') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          reminders = JSON.parse(body);
          saveRemindersToDisk();
          log(`Reminders synced from app: ${reminders.length} reminder(s)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: reminders.length }));
        } catch (e) {
          log(`Bad reminder payload: ${e.message}`);
          res.writeHead(400); res.end('Bad JSON');
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/reminders') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reminders));
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200); res.end('ExamRigor bg-notifier running');
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(HTTP_PORT, '127.0.0.1', () => {
    log(`HTTP server listening on http://localhost:${HTTP_PORT}`);
    log(`App can POST reminders to http://localhost:${HTTP_PORT}/reminders`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${HTTP_PORT} already in use — reminder sync server skipped`);
    } else {
      log(`HTTP server error: ${err.message}`);
    }
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────
function startupSequence() {
  log(`ExamRigor Background Notifier v2 started (PID: ${process.pid})`);
  log(`Next 4-hour check-in in ${INTERVAL_HOURS} hours`);
  loadReminders();
  startHttpServer();
  playBeep(1);
  sendTelegram('✅ ExamRigor — Background Alerts ON (v2 with reminder sync)');
  setTimeout(() => {
    showNotification(
      '✅ ExamRigor — Background Alerts ON',
      `Alerts active. Reminders synced from app. 4-hr check every ${INTERVAL_HOURS}h.`
    );
  }, 600);
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
startupSequence();

// 4-hour periodic alert
setInterval(triggerStudyAlert, INTERVAL_MS);

// Reminder check every 30 seconds (catches reminders within a 30s window)
setInterval(checkReminders, 30 * 1000);

// ── Resilience ────────────────────────────────────────────────────────────────
process.on('uncaughtException',  (err)    => { log(`Uncaught error (continuing): ${err.message}`); });
process.on('unhandledRejection', (reason) => { log(`Unhandled rejection: ${reason}`); });

// PID file so stop-script can kill the process
const PID_FILE = path.join(__dirname, 'bg-notifier.pid');
try { fs.writeFileSync(PID_FILE, String(process.pid)); log(`PID ${process.pid} written`); } catch (_) {}
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch (_) {} });

log(`Process running. PID: ${process.pid}`);
