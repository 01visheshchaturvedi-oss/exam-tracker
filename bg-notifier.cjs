// ExamRigor Background Notifier v3 (CommonJS)
// Runs via: node bg-notifier.cjs
// - Fires 4-hour check-in beep + Windows toast
// - Fires task reminders every 30s check (survives app close)
// - HTTP server on port 3001 receives reminder sync from browser app
// - NO emoji in PS1 strings (avoids encoding crashes)

const { exec } = require('child_process');
const fs       = require('fs');
const path     = require('path');
const http     = require('http');

// ── Try loading dotenv (optional) ────────────────────────────────────────────
try { require('dotenv').config(); } catch(_) {}

// ── Config ───────────────────────────────────────────────────────────────────
const INTERVAL_HOURS = 4;
const INTERVAL_MS    = INTERVAL_HOURS * 60 * 60 * 1000;
const LOG_FILE       = path.join(__dirname, 'bg-notifier.log');
const REMINDERS_FILE = path.join(__dirname, 'bg-reminders.json');
const CONFIG_FILE    = path.join(__dirname, 'bg-config.json');
const HTTP_PORT      = 3001;

// ── YouTube Channel Monitors ─────────────────────────────────────────────────
// Uses YouTube's free public RSS feed — NO API key required
var YT_CHANNELS = [
  {
    id:        'UCAgu5EJBK_HkeQE9KbnzqyA',
    name:      'LEARNING CAPSULES - HARSHAL AGRAWAL',
    taskName:  'Quant YT class',
    subject:   'Quant'
  },
  {
    id:        'UCx2bCaJoAeRb43M24DYvGfg',
    name:      'Studyniti - Study with Smriti',
    taskName:  'Reasoning YT class',
    subject:   'Reasoning'
  }
];
var YT_SEEN_FILE    = path.join(__dirname, 'bg-yt-seen.json');
var YT_PENDING_FILE = path.join(__dirname, 'bg-yt-pending.json');
var ytSeen    = {};    // { channelId: ['videoId1', 'videoId2', ...] }
var ytPending = [];    // alerts waiting to be picked up by app

// ── Runtime config ───────────────────────────────────────────────────────────
let appConfig = {};

function loadConfig() {
  // Priority: bg-config.json (written by app UI) > .env
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      appConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      log('Config loaded from bg-config.json');
    } else {
      log('No bg-config.json yet');
    }
  } catch(e) { log('Config load error: ' + e.message); }
}

// ── State ────────────────────────────────────────────────────────────────────
let reminders  = [];
const fired    = new Set();  // "task_id-HH:MM-DateString"
let lastMinute = '';         // track minute changes

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = '[' + new Date().toLocaleString('en-IN') + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(_) {}
}

// ── Beep via PowerShell Console.Beep ────────────────────────────────────────
function playBeep(times) {
  times = times || 3;
  var parts = [];
  for (var i = 0; i < times; i++) {
    parts.push('[console]::Beep(880,400)');
    if (i < times - 1) parts.push('Start-Sleep -Milliseconds 350');
  }
  var cmd = 'powershell -NoProfile -NonInteractive -Command "' + parts.join('; ') + '"';
  exec(cmd, function(err) {
    if (err) {
      // Fallback: old mshta beep
      exec('mshta vbscript:Execute("Beep:window.close")', function(){});
      log('Beep fallback used');
    }
  });
}

// ── Windows Toast — ASCII-only strings avoid encoding crashes ────────────────
function showToast(title, body) {
  // Strip any non-ASCII chars to be safe
  var safeTitle = title.replace(/[^\x00-\x7F]/g, '').replace(/"/g, '').replace(/'/g, '');
  var safeBody  = body.replace(/[^\x00-\x7F]/g, '').replace(/"/g, '').replace(/'/g, '');

  var ps = [
    '$AppId = \'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe\'',
    'try {',
    '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '  $xml = @"',
    '<toast duration="long">',
    '  <visual><binding template="ToastGeneric">',
    '    <text>' + safeTitle + '</text>',
    '    <text>' + safeBody  + '</text>',
    '  </binding></visual>',
    '  <audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="false"/>',
    '</toast>',
    '"@',
    '  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '  $doc.loadXml($xml)',
    '  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc',
    '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)',
    '} catch {',
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  $n = New-Object System.Windows.Forms.NotifyIcon',
    '  $n.Icon = [System.Drawing.SystemIcons]::Information',
    '  $n.BalloonTipTitle = \'' + safeTitle + '\'',
    '  $n.BalloonTipText  = \'' + safeBody  + '\'',
    '  $n.Visible = $true',
    '  $n.ShowBalloonTip(8000)',
    '  Start-Sleep -Seconds 10',
    '  $n.Visible = $false; $n.Dispose()',
    '}'
  ].join('\n');

  var tmp = path.join(require('os').tmpdir(), 'examrigor_toast.ps1');
  try {
    fs.writeFileSync(tmp, ps, 'utf8');
    exec('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmp + '"', function(err) {
      if (err) log('Toast error: ' + err.message.split('\n')[0]);
      try { fs.unlinkSync(tmp); } catch(_) {}
    });
  } catch(e) { log('Toast write failed: ' + e.message); }
}

// ── Load / Save reminders ────────────────────────────────────────────────────
function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
      log('Loaded ' + reminders.length + ' reminder(s) from disk');
    } else {
      log('No bg-reminders.json found — reminders will sync when app is open');
    }
  } catch(e) { log('Load reminders failed: ' + e.message); }
}

function saveReminders() {
  try { fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8'); }
  catch(e) { log('Save reminders failed: ' + e.message); }
}

// ── Check reminders — called every 10 seconds ────────────────────────────────
function checkReminders() {
  if (!reminders || reminders.length === 0) return;
  var now     = new Date();
  var hh      = String(now.getHours()).padStart(2, '0');
  var mm      = String(now.getMinutes()).padStart(2, '0');
  var hhmm    = hh + ':' + mm;
  var dateStr = now.toDateString();

  // Only process once per minute (fire as soon as minute changes)
  if (hhmm === lastMinute) return;
  lastMinute = hhmm;

  reminders.filter(function(r) {
    return r.enabled && r.time === hhmm;
  }).forEach(function(r) {
    var key = r.task_id + '-' + hhmm + '-' + dateStr;
    if (!fired.has(key)) {
      fired.add(key);
      log('REMINDER fired: ' + r.task_name + ' at ' + hhmm);
      playBeep(3);
      setTimeout(function() {
        showToast(
          'ExamRigor Reminder: ' + r.task_name,
          'It is ' + hhmm + ' - time to start ' + r.task_name
        );
      }, 500);
    }
  });
}

// ── 4-Hour study alert ────────────────────────────────────────────────────────
function triggerStudyAlert() {
  var now = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  log('ALERT: 4-hour interval fired at ' + now);
  playBeep(3);
  setTimeout(function() {
    showToast(
      'ExamRigor - ' + INTERVAL_HOURS + '-Hour Check',
      'It is ' + now + '. ' + INTERVAL_HOURS + ' hours done. Take a break then get back!'
    );
  }, 800);
}

// ── YouTube RSS Monitor ───────────────────────────────────────────────────────
function loadYtSeen() {
  try {
    if (fs.existsSync(YT_SEEN_FILE)) {
      ytSeen = JSON.parse(fs.readFileSync(YT_SEEN_FILE, 'utf8'));
      log('YT: Loaded seen videos for ' + Object.keys(ytSeen).length + ' channel(s)');
    }
  } catch(e) { log('YT: loadYtSeen error: ' + e.message); }
}

function saveYtSeen() {
  try { fs.writeFileSync(YT_SEEN_FILE, JSON.stringify(ytSeen, null, 2), 'utf8'); }
  catch(e) { log('YT: saveYtSeen error: ' + e.message); }
}

function loadYtPending() {
  try {
    if (fs.existsSync(YT_PENDING_FILE)) {
      ytPending = JSON.parse(fs.readFileSync(YT_PENDING_FILE, 'utf8'));
    }
  } catch(e) { ytPending = []; }
}

function saveYtPending() {
  try { fs.writeFileSync(YT_PENDING_FILE, JSON.stringify(ytPending, null, 2), 'utf8'); }
  catch(e) { log('YT: saveYtPending error: ' + e.message); }
}

// Parse YouTube RSS XML without any npm packages — regex is reliable for this feed format
function parseYtRss(xml) {
  var videos = [];
  // Each video entry is wrapped in <entry>...</entry>
  var entryRx = /<entry>([\s\S]*?)<\/entry>/g;
  var match;
  while ((match = entryRx.exec(xml)) !== null) {
    var entry = match[1];
    var idMatch    = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    var titleMatch = entry.match(/<title>([^<]+)<\/title>/);
    var pubMatch   = entry.match(/<published>([^<]+)<\/published>/);
    var linkMatch  = entry.match(/<link rel="alternate" href="([^"]+)"/);
    if (idMatch && titleMatch) {
      videos.push({
        id:        idMatch[1].trim(),
        title:     titleMatch[1].trim(),
        published: pubMatch ? pubMatch[1].trim() : '',
        url:       linkMatch ? linkMatch[1].trim() : ('https://www.youtube.com/watch?v=' + idMatch[1].trim())
      });
    }
  }
  return videos;
}

async function checkYouTube() {
  if (!fetch) { log('YT: node-fetch not available — skipping YouTube check'); return; }
  log('YT: Checking channels...');

  for (var i = 0; i < YT_CHANNELS.length; i++) {
    var ch = YT_CHANNELS[i];
    var rssUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id;
    try {
      var res = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { log('YT: RSS fetch error for ' + ch.name + ': HTTP ' + res.status); continue; }
      var xml     = await res.text();
      var videos  = parseYtRss(xml);
      if (videos.length === 0) { log('YT: No videos parsed for ' + ch.name); continue; }

      // On first run, just seed the seen list — don't alert for old videos
      if (!ytSeen[ch.id]) {
        ytSeen[ch.id] = videos.map(function(v) { return v.id; });
        log('YT: Seeded ' + ytSeen[ch.id].length + ' existing videos for ' + ch.name);
        saveYtSeen();
        continue;
      }

      // Find genuinely new videos
      var newVideos = videos.filter(function(v) {
        return ytSeen[ch.id].indexOf(v.id) === -1;
      });

      if (newVideos.length === 0) {
        log('YT: No new videos for ' + ch.name);
        continue;
      }

      // Process each new video
      newVideos.forEach(function(v) {
        log('YT: NEW VIDEO from ' + ch.name + ' — ' + v.title);
        ytSeen[ch.id].push(v.id);

        var now     = new Date();
        var hh      = String(now.getHours()).padStart(2, '0');
        var mm      = String(now.getMinutes()).padStart(2, '0');
        var timeStr = hh + ':' + mm;

        // Beep (3 times — it's a class starting!)
        playBeep(3);

        // Windows toast
        setTimeout(function() {
          showToast(
            'LIVE CLASS: ' + ch.subject + ' by ' + (ch.subject === 'Quant' ? 'Harshal Sir' : 'Smriti Mam'),
            v.title.substring(0, 80)
          );
        }, 400);

        // Store pending alert for the app to pick up
        var alert = {
          id:        'yt-' + v.id,
          channelId: ch.id,
          channelName: ch.name,
          taskName:  ch.taskName,
          subject:   ch.subject,
          videoId:   v.id,
          videoTitle: v.title,
          videoUrl:  v.url,
          detectedAt: now.toISOString(),
          timeStr:   timeStr
        };
        ytPending.push(alert);
      });

      saveYtSeen();
      saveYtPending();

    } catch(e) {
      log('YT: Error checking ' + ch.name + ': ' + e.message);
    }
  }
}

// ── HTTP server — receives reminder sync from the React app ──────────────────
function startHttpServer() {
  var server = http.createServer(function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'POST' && req.url === '/reminders') {
      var body = '';
      req.on('data', function(c) { body += c; });
      req.on('end', function() {
        try {
          reminders = JSON.parse(body);
          saveReminders();
          log('Reminders synced: ' + reminders.length + ' reminder(s)');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: reminders.length }));
        } catch(e) {
          log('Bad reminder JSON: ' + e.message);
          res.writeHead(400); res.end('Bad JSON');
        }
      });
      return;
    }

    // /ping — checks if service is running
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200); res.end('ExamRigor bg-notifier v3 running');
      return;
    }

    // GET /yt-pending — app polls this to receive YouTube alerts
    if (req.method === 'GET' && req.url === '/yt-pending') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ytPending));
      return;
    }

    // POST /yt-pending/clear — app calls this after consuming alerts
    if (req.method === 'POST' && req.url === '/yt-pending/clear') {
      var clearBody = '';
      req.on('data', function(c) { clearBody += c; });
      req.on('end', function() {
        try {
          var ids = JSON.parse(clearBody); // array of alert IDs to remove
          ytPending = ytPending.filter(function(a) { return ids.indexOf(a.id) === -1; });
          saveYtPending();
          res.writeHead(200); res.end(JSON.stringify({ ok: true, remaining: ytPending.length }));
        } catch(e) {
          ytPending = []; saveYtPending(); // clear all on bad body
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        }
      });
      return;
    }

    // POST /yt-check — manually trigger a YouTube check from the app
    if (req.method === 'POST' && req.url === '/yt-check') {
      checkYouTube().catch(function(e){ log('YT manual check error: ' + e.message); });
      res.writeHead(200); res.end(JSON.stringify({ ok: true, message: 'YouTube check triggered' }));
      return;
    }

    // POST /backup — app pushes all localStorage data here for safekeeping
    if (req.method === 'POST' && req.url === '/backup') {
      var backupBody = '';
      req.on('data', function(c) { backupBody += c; });
      req.on('end', function() {
        try {
          var data = JSON.parse(backupBody);
          var backupFile = path.join(__dirname, 'examrigor-backup.json');
          var payload = Object.assign({ _savedAt: new Date().toISOString() }, data);
          fs.writeFileSync(backupFile, JSON.stringify(payload, null, 2), 'utf8');
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch(e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // GET /backup — app reads backup to restore data
    if (req.method === 'GET' && req.url === '/backup') {
      try {
        var backupFile = path.join(__dirname, 'examrigor-backup.json');
        if (fs.existsSync(backupFile)) {
          var raw = fs.readFileSync(backupFile, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(raw);
        } else {
          res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'No backup found' }));
        }
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(HTTP_PORT, '127.0.0.1', function() {
    log('HTTP server ready on http://localhost:' + HTTP_PORT);
  });

  server.on('error', function(err) {
    if (err.code === 'EADDRINUSE') {
      log('Port ' + HTTP_PORT + ' in use — HTTP sync skipped (reminders still load from disk)');
    } else {
      log('HTTP error: ' + err.message);
    }
  });
}

// ── Startup ──────────────────────────────────────────────────────────────────
function startup() {
  log('ExamRigor Background Notifier v3 started (PID: ' + process.pid + ')');
  log('4-hour alerts every ' + INTERVAL_HOURS + 'h');
  loadConfig();
  loadReminders();
  loadYtSeen();
  loadYtPending();
  startHttpServer();

  // Startup beep + toast
  playBeep(1);
  setTimeout(function() {
    showToast('ExamRigor - Background Alerts ON', 'Reminders active. 4-hour check every ' + INTERVAL_HOURS + 'h.');
  }, 800);
}

// ── Main ─────────────────────────────────────────────────────────────────────
startup();

// 4-hour periodic alert
setInterval(triggerStudyAlert, INTERVAL_MS);

// Reminder check every 10 seconds (catches minute change reliably)
setInterval(checkReminders, 10 * 1000);

// YouTube check every 15 minutes
var YT_INTERVAL_MS = 15 * 60 * 1000;
// First check after 30 seconds (let server settle), then every 15 min
setTimeout(function() {
  checkYouTube();
  setInterval(checkYouTube, YT_INTERVAL_MS);
}, 30 * 1000);
log('YT: Channel monitor armed — first check in 30s, then every 15 min');

// ── Resilience ────────────────────────────────────────────────────────────────
process.on('uncaughtException',  function(e) { log('Uncaught: ' + e.message); });
process.on('unhandledRejection', function(r) { log('Rejection: ' + r); });

// PID file
var PID_FILE = path.join(__dirname, 'bg-notifier.pid');
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch(_) {}
process.on('exit', function() { try { fs.unlinkSync(PID_FILE); } catch(_) {} });

log('Process running. PID: ' + process.pid);
