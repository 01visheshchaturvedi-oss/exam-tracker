const DB_NAME = 'examrigor-bg-db';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY_REMINDERS = 'reminders';
const KEY_FIRED = 'fired';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setKV(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getKV(key, fallback) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

function normalizeReminders(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r) => r && typeof r.time === 'string')
    .map((r) => ({
      task_id: Number(r.task_id || 0),
      task_name: String(r.task_name || 'Task'),
      time: String(r.time),
      enabled: !!r.enabled,
    }));
}

function minuteString(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function dayString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function checkAndNotifyDueReminders() {
  const reminders = normalizeReminders(await getKV(KEY_REMINDERS, []));
  if (!reminders.length) return;

  const now = new Date();
  const hhmm = minuteString(now);
  const dateKey = dayString(now);
  const fired = await getKV(KEY_FIRED, {});

  let changed = false;
  for (const r of reminders) {
    if (!r.enabled || r.time !== hhmm) continue;
    const uniqueKey = `${r.task_id}-${r.time}-${dateKey}`;
    if (fired[uniqueKey]) continue;

    fired[uniqueKey] = true;
    changed = true;
    await self.registration.showNotification(`Reminder: ${r.task_name}`, {
      body: `It's ${hhmm} — time to start "${r.task_name}"`,
      tag: uniqueKey,
      renotify: true,
      requireInteraction: true,
      data: { path: '/' },
    });
  }

  if (changed) {
    await setKV(KEY_FIRED, fired);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SYNC_REMINDERS') {
    const reminders = normalizeReminders(data.reminders);
    event.waitUntil(setKV(KEY_REMINDERS, reminders));
    return;
  }
  if (data.type === 'CHECK_REMINDERS_NOW') {
    event.waitUntil(checkAndNotifyDueReminders());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'examrigor-reminder-check') {
    event.waitUntil(checkAndNotifyDueReminders());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'examrigor-reminder-check') {
    event.waitUntil(checkAndNotifyDueReminders());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return undefined;
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || 'ExamRigor Reminder';
  const body = payload.body || 'You have a pending reminder.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      requireInteraction: true,
      data: { path: '/' },
    }),
  );
});
