import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Calendar, BookOpen, AlertTriangle, ChevronRight,
  Settings, Clock, TrendingUp, ListTodo, Plus, Play,
  Square, CheckCircle2, XCircle, History, Brain, Sun, Moon, Target,
  Pencil, Bell, FlaskConical, Save, Pause, LogOut, Menu, X as XIcon,
  Cloud, CloudOff, Loader2
} from 'lucide-react';
import { useAuth } from './AuthContext';
import AuthScreen from './AuthScreen';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useSound } from './hooks/useSound';
import { YouTubeMonitor } from './components/YouTubeMonitor';

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserSettings { name: string; exam_month: string; subject_count: number; negative_motivation: string; theme: 'light' | 'dark'; beep_count_overtime: number; }
interface Task { id: number; name: string; category: 'core' | 'life'; type: 'standard' | 'normal'; standard_minutes?: number; }
interface TaskLog { id: string; task_id: number; task_name: string; category: 'core' | 'life'; duration_seconds: number; is_overtime: boolean; overtime_reason: string; date: string; logged_at: number; }
interface Benchmark { task_name: string; best_seconds: number; last_seconds: number; sessions: number; }
interface DailyGoal { date: string; goal_hours: number; set_at: number; }
interface ActiveTaskState {
  task: Task;
  start_timestamp: number;      // wall-clock ms when task started
  is_overtime: boolean;
  paused_at: number | null;     // wall-clock ms when paused (null = running)
  accumulated_pause_ms: number; // total ms spent in paused state
  extra_seconds?: number;       // seconds carried over from a previous stopped session (Continue feature)
}
interface LastStoppedInfo { task: Task; logId: string; elapsed_seconds: number; }
interface TaskReminder { task_id: number; task_name: string; time: string; enabled: boolean; }

// ─── Browser / Desktop Notifications ──────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
function showBrowserNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Prefer Service Worker notifications so they keep working better in background.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, { body, requireInteraction: true }))
      .catch(() => {
        try { new Notification(title, { body, silent: false }); } catch {}
      });
    return;
  }

  try { new Notification(title, { body, silent: false }); } catch {}
}

async function syncRemindersToServiceWorker(reminders: TaskReminder[]) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active || reg.waiting || reg.installing;
    target?.postMessage({ type: 'SYNC_REMINDERS', reminders });
  } catch (_) {}
}

async function triggerServiceWorkerReminderCheck() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active || reg.waiting || reg.installing;
    target?.postMessage({ type: 'CHECK_REMINDERS_NOW' });
  } catch (_) {}
}

// ─── localStorage helpers ─────────────────────────────────────────────────────
// Module-level bridge: set by App component once auth hook is available
let _pushToCloud: ((key: string, value: string) => void) | null = null;
export function setPushToCloud(fn: (key: string, value: string) => void) { _pushToCloud = fn; }

const LS = {
  get: <T,>(key: string, fb: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set: <T,>(key: string, val: T) => {
    try {
      const jsonVal = JSON.stringify(val);
      localStorage.setItem(key, jsonVal);
      // Mirror to Firestore cloud if user is logged in
      if (_pushToCloud) _pushToCloud(key, jsonVal);
      // Debounced backup push: coalesce rapid writes into one request
      if (BACKUP_KEYS.includes(key)) {
        clearTimeout((LS as any)._bt);
        (LS as any)._bt = setTimeout(pushBackup, 3000);
      }
    } catch {}
  },
};
const KEYS = { settings:'examrigor_settings', library:'examrigor_library', dailyTasks:'examrigor_daily_tasks', logs:'examrigor_logs', benchmarks:'examrigor_benchmarks', dailyGoals:'examrigor_daily_goals', activeTask:'examrigor_active_task', reminders:'examrigor_reminders', pausedTasks:'examrigor_paused_tasks', lastStopped:'examrigor_last_stopped' };

// ─── Auto-Backup: saves all data to bg-notifier server → disk ────────────────
const BACKUP_KEYS = ['examrigor_settings','examrigor_library','examrigor_daily_tasks','examrigor_logs','examrigor_benchmarks','examrigor_daily_goals','examrigor_reminders'];
async function pushBackup() {
  try {
    const payload: Record<string, string> = {};
    BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v) payload[k] = v; });
    if (Object.keys(payload).length === 0) return;
    await fetch('http://localhost:3001/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}
async function restoreFromBackup(): Promise<boolean> {
  try {
    const r = await fetch('http://localhost:3001/backup');
    if (!r.ok) return false;
    const data = await r.json();
    let restored = 0;
    BACKUP_KEYS.forEach(k => { if (data[k]) { localStorage.setItem(k, data[k]); restored++; } });
    return restored > 0;
  } catch (_) { return false; }
}
const todayKey = () => new Date().toISOString().split('T')[0];

// ─── Default Tasks ────────────────────────────────────────────────────────────
const DEFAULT_TASKS: Task[] = [
  { id:1001, name:'Quants Practice',          category:'core', type:'standard', standard_minutes:60  },
  { id:1002, name:'Reasoning Practice',       category:'core', type:'standard', standard_minutes:60  },
  { id:1003, name:'English Practice',         category:'core', type:'standard', standard_minutes:45  },
  { id:1004, name:'GA Class',                 category:'core', type:'normal' },
  { id:1005, name:'Quant YT Class',           category:'core', type:'normal' },
  { id:1006, name:'Reasoning YT Class',       category:'core', type:'normal' },
  { id:1007, name:'Editorial',                category:'core', type:'standard', standard_minutes:30  },
  { id:1008, name:'English & Reasoning Mock', category:'core', type:'standard', standard_minutes:120 },
  { id:1009, name:'Calculation Practice',     category:'core', type:'standard', standard_minutes:30  },
];
function seedDefaultTasks() {
  const lib = LS.get<Task[]>(KEYS.library, []); let changed = false;
  DEFAULT_TASKS.forEach(dt => {
    const idx = lib.findIndex(t => t.id === dt.id);
    if (idx === -1) { lib.push(dt); changed = true; }
    else if (lib[idx].type !== dt.type || lib[idx].standard_minutes !== dt.standard_minutes) { lib[idx] = { ...lib[idx], type:dt.type, standard_minutes:dt.standard_minutes }; changed = true; }
  });
  if (changed) LS.set(KEYS.library, lib);
  // Per-day seeding: default tasks are auto-added to each new day's list
  const todaySeedKey = `examrigor_seeded_${todayKey()}`;
  if (!LS.get(todaySeedKey, false)) {
    const all: Record<string,number[]> = LS.get(KEYS.dailyTasks, {});
    const ids = all[todayKey()] ?? [];
    DEFAULT_TASKS.forEach(dt => { if (!ids.includes(dt.id)) ids.push(dt.id); });
    all[todayKey()] = ids; LS.set(KEYS.dailyTasks, all); LS.set(todaySeedKey, true);
  }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
function getLibrary(): Task[] { return LS.get(KEYS.library, []); }
function saveLibrary(t: Task[]) { LS.set(KEYS.library, t); }
function getTodayTaskIds(): number[] { const all: Record<string,number[]> = LS.get(KEYS.dailyTasks, {}); return all[todayKey()] ?? []; }
function saveTodayTaskIds(ids: number[]) { const all: Record<string,number[]> = LS.get(KEYS.dailyTasks, {}); all[todayKey()] = ids; LS.set(KEYS.dailyTasks, all); }
function getLogs(): TaskLog[] { return LS.get(KEYS.logs, []); }
function appendLog(log: TaskLog) { const logs = getLogs(); logs.push(log); LS.set(KEYS.logs, logs); }
function deleteLog(id: string) { LS.set(KEYS.logs, getLogs().filter(l => l.id !== id)); }
function getBenchmarks(): Record<string,Benchmark> { return LS.get(KEYS.benchmarks, {}); }
function deleteBenchmark(taskName: string) { const bm = getBenchmarks(); delete bm[taskName]; LS.set(KEYS.benchmarks, bm); }
function updateBenchmark(log: TaskLog) {
  if (log.category === 'life') return; // no benchmarks for life tasks
  const bm = getBenchmarks(); const ex = bm[log.task_name];
  bm[log.task_name] = !ex
    ? { task_name:log.task_name, best_seconds:log.duration_seconds, last_seconds:log.duration_seconds, sessions:1 }
    : { ...ex, best_seconds:Math.min(ex.best_seconds, log.duration_seconds), last_seconds:log.duration_seconds, sessions:ex.sessions+1 };
  LS.set(KEYS.benchmarks, bm);
}
function getTodayGoal(): DailyGoal | null { const goals: Record<string,DailyGoal> = LS.get(KEYS.dailyGoals, {}); return goals[todayKey()] ?? null; }
function setTodayGoalFn(hours: number) { const goals: Record<string,DailyGoal> = LS.get(KEYS.dailyGoals, {}); goals[todayKey()] = { date:todayKey(), goal_hours:hours, set_at:Date.now() }; LS.set(KEYS.dailyGoals, goals); }
function saveActiveTask(s: ActiveTaskState | null) { LS.set(KEYS.activeTask, s); }
function loadActiveTask(): ActiveTaskState | null { return LS.get<ActiveTaskState | null>(KEYS.activeTask, null); }
function savePausedTasks(s: ActiveTaskState[]) { LS.set(KEYS.pausedTasks, s); }
function loadPausedTasks(): ActiveTaskState[] { return LS.get<ActiveTaskState[]>(KEYS.pausedTasks, []); }
function saveLastStopped(r: Record<number, LastStoppedInfo>) { LS.set(KEYS.lastStopped, r); }
function loadLastStopped(): Record<number, LastStoppedInfo> { return LS.get<Record<number,LastStoppedInfo>>(KEYS.lastStopped, {}); }
function getReminders(): TaskReminder[] { return LS.get(KEYS.reminders, []); }
function saveReminders(r: TaskReminder[]) { LS.set(KEYS.reminders, r); }

// ─── Analytics helpers ────────────────────────────────────────────────────────
// All stats below are CORE-only (life tasks tracked separately)
function computeWeeklyStats() {
  const logs = getLogs().filter(l => l.category==='core'); const result: Record<string,any> = {};
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); const k = d.toISOString().split('T')[0]; result[k] = { date:k.slice(5), total_seconds:0, overtime_count:0 }; }
  logs.forEach(l => { if (result[l.date]) { result[l.date].total_seconds += l.duration_seconds; if (l.is_overtime) result[l.date].overtime_count++; } });
  return Object.values(result);
}
function computeSubjectStats() {
  const map: Record<string,number> = {};
  getLogs().filter(l => l.category==='core').forEach(l => { map[l.task_name] = (map[l.task_name]||0) + l.duration_seconds; });
  return Object.entries(map).map(([subject,total_seconds]) => ({ subject, total_seconds }));
}
function computeTimelineToday() { return getLogs().filter(l => l.date===todayKey()).sort((a,b) => a.logged_at-b.logged_at); }
// Only core tasks count toward "Time Studied" and goal progress
function computeTodayStats() { const logs = getLogs().filter(l => l.date===todayKey() && l.category==='core'); return { total_seconds:logs.reduce((a,l)=>a+l.duration_seconds,0), overtime_count:logs.filter(l=>l.is_overtime).length }; }

// ─── Life-task analytics helpers (separate from core study stats) ─────────────
function computeLifeWeeklyStats() {
  const logs = getLogs().filter(l => l.category==='life'); const result: Record<string,any> = {};
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); const k = d.toISOString().split('T')[0]; result[k] = { date:k.slice(5), total_seconds:0 }; }
  logs.forEach(l => { if (result[l.date]) result[l.date].total_seconds += l.duration_seconds; });
  return Object.values(result);
}
function computeLifeTaskStats() {
  const map: Record<string,number> = {};
  getLogs().filter(l => l.category==='life').forEach(l => { map[l.task_name] = (map[l.task_name]||0) + l.duration_seconds; });
  return Object.entries(map).map(([task,total_seconds]) => ({ task, total_seconds }));
}
function computeLifeTimelineToday() { return getLogs().filter(l => l.date===todayKey() && l.category==='life').sort((a,b) => a.logged_at-b.logged_at); }
function formatTime(s: number): string { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${h>0?h+':':''}${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`; }
function formatClock(ts: number): string { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

// ─── Core timer math ──────────────────────────────────────────────────────────
// Single source of truth. Works correctly across restarts, tab switches, pauses.
// elapsed = (effectiveNow - start_timestamp) - accumulated_pause_ms
// When paused: effectiveNow is frozen at paused_at, so timer stays still.
// When running: effectiveNow = wallNow, so timer advances in real time.
function computeEffectiveElapsed(state: ActiveTaskState, wallNow: number): number {
  const effectiveNow = state.paused_at ?? wallNow;
  const pauseMs = state.accumulated_pause_ms ?? 0;
  return Math.max(0, Math.floor((effectiveNow - state.start_timestamp - pauseMs) / 1000)) + (state.extra_seconds ?? 0);
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, loading: authLoading, syncStatus, logOut, pushToCloud } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settings, setSettings]       = useState<UserSettings | null>(null);
  const [step, setStep]               = useState(1);
  const [view, setView]               = useState<'tasks'|'analytics'|'benchmarks'|'settings'>('tasks');
  const [library, setLibrary]         = useState<Task[]>([]);
  const [todayTasks, setTodayTasks]   = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [benchmarks, setBenchmarks]   = useState<Record<string,Benchmark>>({});
  const [todayStats, setTodayStats]   = useState({ total_seconds:0, overtime_count:0 });
  const [weeklyStats, setWeeklyStats] = useState<any[]>([]);
  const [subjectStats, setSubjectStats] = useState<any[]>([]);
  const [timelineStats, setTimelineStats] = useState<any[]>([]);
  const [lifeWeeklyStats, setLifeWeeklyStats] = useState<any[]>([]);
  const [lifeTaskStats, setLifeTaskStats] = useState<any[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [activeTaskState, setActiveTaskState] = useState<ActiveTaskState | null>(null);
  const [displayTimer, setDisplayTimer] = useState(0);
  const [showOvertimeModal, setShowOvertimeModal] = useState(false);
  const [overtimeReason, setOvertimeReason] = useState('');
  const [benchmarkBreached, setBenchmarkBreached] = useState(false);
  const [formData, setFormData]       = useState<UserSettings>({ name:'', exam_month:'', subject_count:1, negative_motivation:'', theme:'dark', beep_count_overtime:3 });
  const [newTask, setNewTask]         = useState({ name:'', category:'core' as 'core'|'life', type:'normal' as 'standard'|'normal', standard_minutes:30 });
  const [todayGoal, setTodayGoal]     = useState<DailyGoal | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalInput, setGoalInput]     = useState('8');
  // Non-blocking recovery banner (replaces old blocking modal)
  const [recoveryBanner, setRecoveryBanner] = useState<string | null>(null);
  const [now, setNow]                 = useState(Date.now());
  const tickRef = useRef<any>(null);
  const overtimeFiredRef = useRef(false);
  const recoveryTimerRef = useRef<any>(null);
  const [showSampleTimer, setShowSampleTimer] = useState(false);
  const { playBeep } = useSound();
  const [reminders, setReminders]     = useState<TaskReminder[]>(() => getReminders());
  const [showReminderFor, setShowReminderFor] = useState<Task | null>(null);
  const [reminderInput, setReminderInput] = useState('');
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const lastMinuteRef     = useRef<string>('');
  // Multi-pause: list of all currently paused tasks
  const [pausedTasks, setPausedTasks] = useState<ActiveTaskState[]>([]);
  // Frozen display timers for each paused task keyed by start_timestamp
  const [pausedTimers, setPausedTimers] = useState<Record<number, number>>({});
  // Per-task Continue data: last stopped session info
  const [lastStoppedTasks, setLastStoppedTasks] = useState<Record<number, LastStoppedInfo>>({});

  // ── YouTube alert state ──────────────────────────────────────────────────
  interface YtAlert {
    id: string; channelId: string; channelName: string;
    taskName: string; videoId: string; videoTitle: string; videoUrl: string;
    detectedAt: string; timeStr: string;
  }
  const [ytAlerts, setYtAlerts]           = useState<YtAlert[]>([]);
  const [ytDismissed, setYtDismissed]     = useState<Set<string>>(new Set());
  const ytSeenIdsRef                      = useRef<Set<string>>(new Set());

  const reload = useCallback(() => {
    const lib = getLibrary(); const ids = getTodayTaskIds();
    setLibrary(lib); setTodayTasks(lib.filter(t => ids.includes(t.id)));
    setBenchmarks(getBenchmarks()); setTodayStats(computeTodayStats());
    setWeeklyStats(computeWeeklyStats()); setSubjectStats(computeSubjectStats());
    setTimelineStats(computeTimelineToday());
    setLifeWeeklyStats(computeLifeWeeklyStats()); setLifeTaskStats(computeLifeTaskStats());
    setCompletedIds(new Set(getLogs().filter(l=>l.date===todayKey()).map(l=>l.task_id)));
  }, []);

  // ── Wire pushToCloud bridge to auth hook ─────────────────────────────────
  useEffect(() => { setPushToCloud(pushToCloud); }, [pushToCloud]);

  // ── Reload app data whenever Firebase hydrates localStorage after login ──
  useEffect(() => {
    if (user && syncStatus === 'synced') {
      const saved = LS.get<UserSettings | null>(KEYS.settings, null);
      if (saved) { setSettings(saved); setFormData(saved); }
      reload();
      const goal = getTodayGoal(); setTodayGoal(goal);
    }
  }, [user, syncStatus]);

  // ── Boot ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    seedDefaultTasks();
    const saved = LS.get<UserSettings | null>(KEYS.settings, null);
    if (saved) {
      // Migrate old settings that predate beep_count_overtime
      const migrated = { ...saved, beep_count_overtime: saved.beep_count_overtime ?? 3 };
      setSettings(migrated); setFormData(migrated);
    }
    reload();
    requestNotificationPermission();
    syncRemindersToServiceWorker(getReminders());
    const goal = getTodayGoal(); setTodayGoal(goal);
    if (saved && !goal) setShowGoalModal(true);

    // ── Auto-backup: push to disk every 5 min + immediately on load ────────
    pushBackup();
    const backupInterval = setInterval(pushBackup, 5 * 60 * 1000);

    // ── Auto-restore: if localStorage is empty, restore from disk backup ──
    if (!saved) {
      restoreFromBackup().then(ok => {
        if (ok) {
          const restoredSettings = LS.get<UserSettings | null>(KEYS.settings, null);
          if (restoredSettings) {
            setSettings(restoredSettings); setFormData(restoredSettings);
            reload();
            setRecoveryBanner('✅ Data restored from backup! All your settings, logs and tasks are back.');
            setTimeout(() => setRecoveryBanner(null), 8000);
          }
        }
      });
    }

    const handleYtAlert = (alert: YtAlert) => {
      setYtAlerts(prev => {
        if (prev.find(a => a.id === alert.id)) return prev;
        return [...prev, alert];
      });
      showBrowserNotification(
        `Live Class: ${alert.taskName}`,
        `${alert.channelName} just uploaded: ${alert.videoTitle}`
      );
    };

    // ── Seamless session recovery ─────────────────────────────────────────
    // Load all paused tasks
    const savedPaused = loadPausedTasks();
    if (savedPaused.length > 0) {
      const migrated = savedPaused.map(s => ({
        ...s, paused_at: s.paused_at ?? Date.now(),
        accumulated_pause_ms: s.accumulated_pause_ms ?? 0,
        extra_seconds: s.extra_seconds ?? 0,
      }));
      setPausedTasks(migrated);
      savePausedTasks(migrated);
    }
    // Load last-stopped data for Continue buttons
    const savedLS = loadLastStopped();
    if (Object.keys(savedLS).length > 0) setLastStoppedTasks(savedLS);

    const interrupted = loadActiveTask();
    if (interrupted?.task) {
      const wallNow = Date.now();
      const state: ActiveTaskState = {
        ...interrupted,
        paused_at: interrupted.paused_at ?? null,
        accumulated_pause_ms: interrupted.accumulated_pause_ms ?? 0,
        extra_seconds: interrupted.extra_seconds ?? 0,
      };
      const elapsed = computeEffectiveElapsed(state, wallNow);
      const alreadyOvertime = state.task.type === 'standard' && state.task.standard_minutes
        ? elapsed >= state.task.standard_minutes * 60 : false;
      const final = alreadyOvertime ? { ...state, is_overtime: true } : state;
      setActiveTaskState(final);
      saveActiveTask(final);
      overtimeFiredRef.current = final.is_overtime;
      if (alreadyOvertime) setTimeout(() => setShowOvertimeModal(true), 400);
      const pausedNote = final.paused_at ? ' (was paused)' : '';
      setRecoveryBanner(`⚡ Auto-resumed: "${state.task.name}" · ${formatTime(elapsed)} elapsed${pausedNote}`);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = setTimeout(() => setRecoveryBanner(null), 6000);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      clearInterval(backupInterval);
      if (bgPollInterval) clearInterval(bgPollInterval);
    };
  }, []);

  // ── Clock tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => {
      const n = Date.now(); setNow(n);
      const d = new Date(n);
      const hhmm = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      // Fire on minute change — more reliable than checking seconds===0
      if (hhmm !== lastMinuteRef.current) {
        lastMinuteRef.current = hhmm;
        triggerServiceWorkerReminderCheck();
        getReminders().filter(r=>r.enabled&&r.time===hhmm).forEach(r => {
          const key = `${r.task_id}-${hhmm}-${d.toDateString()}`;
          if (!firedRemindersRef.current.has(key)) {
            firedRemindersRef.current.add(key);
            playBeep(3);
            showBrowserNotification(
              `Reminder: ${r.task_name}`,
              `It's ${hhmm} — time to start "${r.task_name}"`
            );
          }
        });
      }
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  // ── Timer display — recomputed every tick from persisted timestamps ───────
  useEffect(() => {
    // Update frozen timers for all paused tasks
    if (pausedTasks.length > 0) {
      const pt: Record<number, number> = {};
      pausedTasks.forEach(s => { pt[s.start_timestamp] = computeEffectiveElapsed(s, now); });
      setPausedTimers(pt);
    }

    if (!activeTaskState) { setDisplayTimer(0); return; }
    const isPaused = !!activeTaskState.paused_at;
    const elapsed = computeEffectiveElapsed(activeTaskState, now);
    setDisplayTimer(elapsed);
    if (isPaused) return; // No overtime checks while paused
    const task = activeTaskState.task;
    if (task.type==='standard' && task.standard_minutes && elapsed >= task.standard_minutes*60 && !overtimeFiredRef.current) {
      overtimeFiredRef.current = true;
      setActiveTaskState(prev => prev ? { ...prev, is_overtime:true } : prev);
      const beepCnt = settings?.beep_count_overtime ?? 3;
      playBeep(beepCnt);
      showBrowserNotification(
        `⚠️ Overtime: ${task.name}`,
        `You have exceeded the standard time of ${task.standard_minutes} minutes!`
      );
    }
    if (task.type==='normal' && !overtimeFiredRef.current) {
      const bm = getBenchmarks()[task.name];
      if (bm && elapsed >= bm.best_seconds && !benchmarkBreached) {
        setBenchmarkBreached(true);
        playBeep(2);
        showBrowserNotification(`⚡ Benchmark Exceeded: ${task.name}`, `You've passed your best time of ${formatTime(bm.best_seconds)}`);
      }
    }
  }, [now, activeTaskState, pausedTasks, benchmarkBreached]);

  // ── Visibility change — re-sync timer when tab regains focus ─────────────
  useEffect(() => {
    const fn = () => { if (document.visibilityState==='visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);

  // Mirror reminder schedule to Service Worker for background checks.
  useEffect(() => {
    syncRemindersToServiceWorker(reminders);
  }, [reminders]);

  const goalCompletionTime = () => {
    if (!todayGoal) return null;
    const rem = Math.max(0, todayGoal.goal_hours*3600 - todayStats.total_seconds - (activeTaskState?.task?.category==='core'?displayTimer:0));
    return { time: formatClock(Date.now()+rem*1000), remainingSec: rem };
  };

  const saveSettings = (s: UserSettings) => { LS.set(KEYS.settings,s); setSettings(s); setFormData(s); };
  const handleOnboarding = () => { saveSettings({ ...formData, theme:'dark' }); setShowGoalModal(true); };
  const handleSaveSettings = () => { saveSettings(formData); setView('tasks'); };
  const toggleTheme = () => { if (!settings) return; saveSettings({ ...settings, theme: settings.theme==='dark'?'light':'dark' }); };

  const handleSetReminder = (task: Task, time: string) => {
    const updated = [...reminders.filter(r=>r.task_id!==task.id), { task_id:task.id, task_name:task.name, time, enabled:true }];
    saveReminders(updated); setReminders(updated); setShowReminderFor(null);
  };
  const toggleReminder = (id: number) => { const u = reminders.map(r=>r.task_id===id?{...r,enabled:!r.enabled}:r); saveReminders(u); setReminders(u); };
  const deleteReminder = (id: number) => { const u = reminders.filter(r=>r.task_id!==id); saveReminders(u); setReminders(u); };

  const handleEditTask = (taskId: number, changes: Partial<Task>) => {
    const lib = getLibrary(); const idx = lib.findIndex(t=>t.id===taskId);
    if (idx===-1) return; lib[idx] = { ...lib[idx], ...changes }; saveLibrary(lib); setEditingTaskId(null); reload();
  };

  const handleSetGoal = () => {
    const h = parseFloat(goalInput); if (!h||h<=0) return;
    const goal = { date:todayKey(), goal_hours:h, set_at:Date.now() };
    setTodayGoal(goal); setTodayGoalFn(h); setShowGoalModal(false);
  };

  const handleAddTask = () => {
    if (!newTask.name.trim()) return;
    const lib = getLibrary();
    const existing = lib.find(t=>t.name.toLowerCase()===newTask.name.trim().toLowerCase());
    let taskId: number;
    if (existing) { taskId = existing.id; }
    else { const t: Task = { id:Date.now(), name:newTask.name.trim(), category:newTask.category, type:newTask.type, standard_minutes:newTask.standard_minutes }; lib.push(t); saveLibrary(lib); taskId = t.id; }
    const ids = getTodayTaskIds(); if (!ids.includes(taskId)) { ids.push(taskId); saveTodayTaskIds(ids); }
    setNewTask({ ...newTask, name:'' }); reload();
  };
  const addToToday = (id: number) => { const ids = getTodayTaskIds(); if (!ids.includes(id)) { ids.push(id); saveTodayTaskIds(ids); } reload(); };
  const removeFromToday = (id: number) => { saveTodayTaskIds(getTodayTaskIds().filter(x=>x!==id)); reload(); };

  // ── Timer operations ──────────────────────────────────────────────────────

  // Start a task. If another task is running, pause it first (don't log it).
  const startTask = (task: Task) => {
    if (activeTaskState && !activeTaskState.paused_at) {
      // Auto-pause the currently running task
      const paused = { ...activeTaskState, paused_at: Date.now() };
      const newPausedList = [...pausedTasks, paused];
      setPausedTasks(newPausedList);
      savePausedTasks(newPausedList);
    } else if (activeTaskState && activeTaskState.paused_at) {
      // Running task is already paused — add it to list if not already there
      const alreadyIn = pausedTasks.some(p => p.start_timestamp === activeTaskState.start_timestamp);
      if (!alreadyIn) {
        const newPausedList = [...pausedTasks, activeTaskState];
        setPausedTasks(newPausedList);
        savePausedTasks(newPausedList);
      }
    }
    overtimeFiredRef.current = false; setBenchmarkBreached(false);
    const s: ActiveTaskState = { task, start_timestamp: Date.now(), is_overtime: false, paused_at: null, accumulated_pause_ms: 0, extra_seconds: 0 };
    setActiveTaskState(s); saveActiveTask(s);
    setView('tasks');
  };

  // Continue a stopped task — picks up from where it left off, deletes the old log.
  const continueTask = (info: LastStoppedInfo) => {
    // Remove old log so the final stop writes the combined total
    deleteLog(info.logId);
    // Start new session with extra_seconds carrying over the previous time
    if (activeTaskState && !activeTaskState.paused_at) {
      const paused = { ...activeTaskState, paused_at: Date.now() };
      const newPausedList = [...pausedTasks, paused];
      setPausedTasks(newPausedList); savePausedTasks(newPausedList);
    } else if (activeTaskState && activeTaskState.paused_at) {
      const alreadyIn = pausedTasks.some(p => p.start_timestamp === activeTaskState.start_timestamp);
      if (!alreadyIn) {
        const newPausedList = [...pausedTasks, activeTaskState];
        setPausedTasks(newPausedList); savePausedTasks(newPausedList);
      }
    }
    // Remove from lastStopped
    const updated = { ...lastStoppedTasks };
    delete updated[info.task.id];
    setLastStoppedTasks(updated); saveLastStopped(updated);
    overtimeFiredRef.current = false; setBenchmarkBreached(false);
    const s: ActiveTaskState = { task: info.task, start_timestamp: Date.now(), is_overtime: false, paused_at: null, accumulated_pause_ms: 0, extra_seconds: info.elapsed_seconds };
    setActiveTaskState(s); saveActiveTask(s);
    setView('tasks'); reload();
  };

  // Continue a completed task from today — looks up today's most recent log for it.
  // Only works for today's completions (not yesterday's).
  const continueCompletedTask = (task: Task) => {
    const todayLogs = getLogs().filter(l => l.task_id === task.id && l.date === todayKey());
    if (todayLogs.length === 0) return;
    // Use the most recent log
    const latest = todayLogs.reduce((a, b) => a.logged_at > b.logged_at ? a : b);
    continueTask({ task, logId: latest.id, elapsed_seconds: latest.duration_seconds });
  };

  // Pause the currently running task — moves it into pausedTasks list.
  const pauseTask = () => {
    if (!activeTaskState || activeTaskState.paused_at) return;
    const paused = { ...activeTaskState, paused_at: Date.now() };
    const newPausedList = [...pausedTasks, paused];
    setPausedTasks(newPausedList); savePausedTasks(newPausedList);
    setActiveTaskState(null); saveActiveTask(null);
  };

  // Resume the running task if it's in-header paused state (legacy — kept for ActiveSession)
  const resumeTaskFromPause = () => {
    if (!activeTaskState || !activeTaskState.paused_at) return;
    const pauseDur = Date.now() - activeTaskState.paused_at;
    const u: ActiveTaskState = { ...activeTaskState, paused_at: null, accumulated_pause_ms: (activeTaskState.accumulated_pause_ms ?? 0) + pauseDur };
    setActiveTaskState(u); saveActiveTask(u);
  };

  // Resume a specific task from the paused queue.
  const resumeFromPausedList = (state: ActiveTaskState) => {
    // If something is running, pause it first
    if (activeTaskState && !activeTaskState.paused_at) {
      const paused = { ...activeTaskState, paused_at: Date.now() };
      const withoutTarget = pausedTasks.filter(p => p.start_timestamp !== state.start_timestamp);
      const newPausedList = [...withoutTarget, paused];
      setPausedTasks(newPausedList); savePausedTasks(newPausedList);
    } else if (activeTaskState && activeTaskState.paused_at) {
      const alreadyIn = pausedTasks.some(p => p.start_timestamp === activeTaskState.start_timestamp);
      const withoutTarget = pausedTasks.filter(p => p.start_timestamp !== state.start_timestamp);
      const newPausedList = alreadyIn ? withoutTarget : [...withoutTarget, activeTaskState];
      setPausedTasks(newPausedList); savePausedTasks(newPausedList);
    } else {
      // Nothing running — just remove from paused list
      const withoutTarget = pausedTasks.filter(p => p.start_timestamp !== state.start_timestamp);
      setPausedTasks(withoutTarget); savePausedTasks(withoutTarget);
    }
    // Absorb the pause duration
    const pauseDur = state.paused_at ? Date.now() - state.paused_at : 0;
    const resumed: ActiveTaskState = { ...state, paused_at: null, accumulated_pause_ms: (state.accumulated_pause_ms ?? 0) + pauseDur };
    overtimeFiredRef.current = resumed.is_overtime; setBenchmarkBreached(false);
    setActiveTaskState(resumed); saveActiveTask(resumed);
    setView('tasks');
  };

  // Stop & log a task from the paused queue.
  const stopPausedTask = (state: ActiveTaskState) => {
    const withoutTarget = pausedTasks.filter(p => p.start_timestamp !== state.start_timestamp);
    setPausedTasks(withoutTarget); savePausedTasks(withoutTarget);
    commitLogWith(state, '');
  };

  // Stop the running task.
  const stopTask = () => {
    if (!activeTaskState) return;
    if (activeTaskState.paused_at) {
      // Absorb final pause
      const pauseDur = Date.now() - activeTaskState.paused_at;
      const resumed: ActiveTaskState = { ...activeTaskState, paused_at: null, accumulated_pause_ms: (activeTaskState.accumulated_pause_ms ?? 0) + pauseDur };
      setActiveTaskState(resumed); saveActiveTask(resumed);
      if (resumed.is_overtime) setShowOvertimeModal(true);
      else commitLogWith(resumed, '');
      return;
    }
    if (activeTaskState.is_overtime) setShowOvertimeModal(true);
    else commitLog('');
  };

  const commitLogWith = (state: ActiveTaskState, reason: string) => {
    const duration = Math.max(1, computeEffectiveElapsed(state, Date.now()));
    const logId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const log: TaskLog = {
      id: logId,
      task_id: state.task.id, task_name: state.task.name, category: state.task.category,
      duration_seconds: duration, is_overtime: state.is_overtime, overtime_reason: reason,
      date: todayKey(), logged_at: Date.now(),
    };
    appendLog(log); updateBenchmark(log);
    // Save to lastStopped so the Continue button can appear
    const updatedLS = { ...lastStoppedTasks, [state.task.id]: { task: state.task, logId, elapsed_seconds: duration } };
    setLastStoppedTasks(updatedLS); saveLastStopped(updatedLS);
    // Only clear activeTaskState if this was the running task
    if (activeTaskState?.start_timestamp === state.start_timestamp) {
      setActiveTaskState(null); saveActiveTask(null);
      setShowOvertimeModal(false); setOvertimeReason('');
    }
    overtimeFiredRef.current = false;
    reload();
  };
  const commitLog = (reason: string) => { if (activeTaskState) commitLogWith(activeTaskState, reason); };

  const remainingHours = () => {
    if (!todayGoal) return '?';
    return Math.max(0,(todayGoal.goal_hours*3600 - todayStats.total_seconds - (activeTaskState?.task?.category==='core'?displayTimer:0))/3600).toFixed(1);
  };

  const handleDeleteLog = (id: string) => { deleteLog(id); reload(); };
  const handleDeleteBenchmark = (taskName: string) => { deleteBenchmark(taskName); reload(); };

  // ── YouTube alert handlers ────────────────────────────────────────────────
  const handleYtDismiss = (alertId: string) => {
    setYtAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  const handleYtStartTask = (alert: YtAlert) => {
    const task = todayTasks.find(t =>
      t.name.toLowerCase().includes(alert.taskName.toLowerCase()) ||
      alert.taskName.toLowerCase().includes(t.name.toLowerCase())
    ) || getLibrary().find(t =>
      t.name.toLowerCase().includes(alert.taskName.toLowerCase()) ||
      alert.taskName.toLowerCase().includes(t.name.toLowerCase())
    );
    if (task) { startTask(task); setView('tasks'); }
    setYtAlerts(prev => prev.filter(a => a.id !== alert.id));
  };

  const th = settings?.theme ?? 'dark';
  const goalInfo = goalCompletionTime();

  // ── Auth loading screen ───────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.4)]">
          <Clock className="w-6 h-6 text-white"/>
        </div>
        <Loader2 className="w-6 h-6 text-white/30 animate-spin"/>
        <p className="text-white/30 text-xs font-mono uppercase tracking-widest">Loading ExamRigor…</p>
      </div>
    </div>
  );

  // ── Auth gate: show login if not signed in ────────────────────────────────
  if (!user) return <LoginScreen />;

  // ── Onboarding ────────────────────────────────────────────────────────────
  if (!settings) return (
    <div className="min-h-screen bg-[#151619] text-white font-sans flex items-center justify-center p-6">
      <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="max-w-md w-full bg-[#1c1d21] border border-white/10 rounded-2xl p-8 shadow-2xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/><span className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-mono">System Initialization</span></div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup ExamRigor</h1>
        </div>
        <AnimatePresence mode="wait">
          {step===1&&(<motion.div key="s1" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} className="space-y-6">
            <div><label className="block text-[10px] uppercase tracking-wider text-white/40 mb-2 font-mono">Your Name</label>
              <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20"/>
                <input autoFocus type="text" className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-red-500/50" placeholder="Enter name..." value={formData.name} onChange={e=>setFormData({...formData,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&formData.name&&setStep(2)}/>
              </div></div>
            <button onClick={()=>setStep(2)} disabled={!formData.name} className="w-full bg-white text-black font-semibold py-3 rounded-xl hover:bg-white/90 flex items-center justify-center gap-2 disabled:opacity-50">Continue <ChevronRight className="w-4 h-4"/></button>
          </motion.div>)}
          {step===2&&(<motion.div key="s2" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} className="space-y-6">
            <div><label className="block text-[10px] uppercase tracking-wider text-white/40 mb-2 font-mono">Exam Month</label>
              <div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20"/>
                <input type="month" className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-red-500/50" value={formData.exam_month} onChange={e=>setFormData({...formData,exam_month:e.target.value})}/>
              </div></div>
            <div><label className="block text-[10px] uppercase tracking-wider text-white/40 mb-2 font-mono">Number of Subjects</label>
              <div className="relative"><BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20"/>
                <input type="number" min="1" className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-red-500/50" value={formData.subject_count} onChange={e=>setFormData({...formData,subject_count:parseInt(e.target.value)||1})}/>
              </div></div>
            <div className="flex gap-3">
              <button onClick={()=>setStep(1)} className="flex-1 bg-white/5 text-white font-semibold py-3 rounded-xl hover:bg-white/10">Back</button>
              <button onClick={()=>setStep(3)} disabled={!formData.exam_month} className="flex-[2] bg-white text-black font-semibold py-3 rounded-xl hover:bg-white/90 flex items-center justify-center gap-2 disabled:opacity-50">Continue <ChevronRight className="w-4 h-4"/></button>
            </div>
          </motion.div>)}
          {step===3&&(<motion.div key="s3" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} className="space-y-6">
            <div><label className="block text-[10px] uppercase tracking-wider text-white/40 mb-2 font-mono">Negative Motivation</label>
              <div className="relative"><AlertTriangle className="absolute left-3 top-3 w-4 h-4 text-white/20"/>
                <textarea className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 h-24 focus:outline-none focus:border-red-500/50 resize-none" placeholder="e.g. If you waste this time, you'll fail." value={formData.negative_motivation} onChange={e=>setFormData({...formData,negative_motivation:e.target.value})}/>
              </div></div>
            <div className="flex gap-3">
              <button onClick={()=>setStep(2)} className="flex-1 bg-white/5 text-white font-semibold py-3 rounded-xl hover:bg-white/10">Back</button>
              <button onClick={handleOnboarding} disabled={!formData.negative_motivation} className="flex-[2] bg-red-600 text-white font-semibold py-3 rounded-xl hover:bg-red-500 disabled:opacity-50">Initialize Rigor</button>
            </div>
          </motion.div>)}
        </AnimatePresence>
      </motion.div>
    </div>
  );

  return (
    <>
      <YouTubeMonitor onAlert={handleYtAlert} />
      {/* ── Author / Version Banner ── */}
      <div className={`w-full text-center text-[11px] font-mono py-1.5 px-4 tracking-wide select-none shrink-0 ${th==='light'?'bg-slate-800 text-white/80 border-b border-slate-700':'bg-[#111215] text-white/40 border-b border-white/5'}`}>
        Author © Vishesh.chaturvedi&nbsp;&nbsp;|&nbsp;&nbsp;All rights reserved&nbsp;&nbsp;|&nbsp;&nbsp;App version: 2.5
      </div>
    <div className={`min-h-screen font-sans flex overflow-hidden transition-colors duration-300 ${th==='light'?'bg-[#f8f9fa] text-slate-900':'bg-[#0a0a0b] text-white'}`}>

      {/* ── Recovery Banner — non-blocking, slides in from top, auto-dismisses ── */}
      <AnimatePresence>
        {recoveryBanner && (
          <motion.div initial={{y:-60,opacity:0}} animate={{y:0,opacity:1}} exit={{y:-60,opacity:0}}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 bg-amber-500 text-black px-5 py-3 rounded-2xl shadow-2xl max-w-lg w-[calc(100%-2rem)]">
            <Clock className="w-4 h-4 shrink-0"/>
            <span className="flex-1 text-xs font-mono font-bold">{recoveryBanner}</span>
            <button onClick={()=>{ if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current); setRecoveryBanner(null); }} className="opacity-70 hover:opacity-100"><XCircle className="w-4 h-4"/></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Daily Goal Modal ── */}
      <AnimatePresence>
        {showGoalModal&&(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 bg-black/80 backdrop-blur-sm"/>
            <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}} className="relative bg-[#1c1d21] border border-red-500/30 rounded-2xl p-8 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-6"><Target className="w-8 h-8 text-red-500"/>
                <div><h2 className="text-xl font-bold">Today's Study Goal</h2><p className="text-white/40 text-xs font-mono">{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long'})}</p></div>
              </div>
              <p className="text-sm text-white/60 mb-4">How many hours will you study today?</p>
              <div className="flex items-center gap-4 mb-6">
                <input type="number" min="0.5" max="20" step="0.5" autoFocus className="flex-1 bg-black/40 border border-white/10 rounded-xl py-4 px-4 text-3xl font-black text-center focus:outline-none focus:border-red-500/50" value={goalInput} onChange={e=>setGoalInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSetGoal()}/>
                <span className="text-white/40 font-mono text-lg">hrs</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-6">
                {['4','6','8','10'].map(h=>(<button key={h} onClick={()=>setGoalInput(h)} className={`py-2 rounded-xl text-sm font-bold border transition-all ${goalInput===h?'bg-red-600 border-red-600 text-white':'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>{h}h</button>))}
              </div>
              <button onClick={handleSetGoal} className="w-full bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-500">Set Goal & Start Day</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Mobile sidebar overlay backdrop ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)}/>
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-40
        w-72 md:w-64 border-r flex flex-col shrink-0
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${th==='light'?'bg-white border-slate-200':'bg-[#0d0e11] border-white/5'}
      `}>
        <div className={`p-5 border-b flex items-center justify-between ${th==='light'?'border-slate-200':'border-white/5'}`}>
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(220,38,38,0.3)]"><Clock className="w-5 h-5 text-white"/></div>
              <h1 className="font-bold tracking-tight text-lg">ExamRigor</h1>
            </div>
            <p className={`text-[10px] font-mono uppercase tracking-widest ml-11 ${th==='light'?'text-slate-400':'text-white/40'}`}>Personal Study OS</p>
          </div>
          <button className="md:hidden p-1.5 rounded-lg opacity-50 hover:opacity-100" onClick={() => setSidebarOpen(false)}>
            <XIcon className="w-4 h-4"/>
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {(['tasks','analytics','benchmarks','settings'] as const).map(v=>(
            <NavItem key={v} icon={v==='tasks'?<ListTodo className="w-4 h-4"/>:v==='analytics'?<TrendingUp className="w-4 h-4"/>:v==='benchmarks'?<History className="w-4 h-4"/>:<Settings className="w-4 h-4"/>}
              label={v==='tasks'?'Daily Tasks':v==='analytics'?'Analytics':v==='benchmarks'?'Benchmarks':'Settings'} active={view===v}
              onClick={()=>{ setView(v); setSidebarOpen(false); }} theme={th}/>
          ))}
        </nav>
        {/* ── Sync + Account status ── */}
        <div className={`mx-4 mb-2 rounded-xl p-3 border flex items-center gap-2 ${th==='light'?'bg-slate-50 border-slate-200':'bg-white/5 border-white/5'}`}>
          {syncStatus === 'syncing' ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0"/> :
           syncStatus === 'synced'  ? <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0"/> :
           syncStatus === 'error'   ? <CloudOff className="w-3.5 h-3.5 text-red-400 shrink-0"/> :
                                      <Cloud className="w-3.5 h-3.5 text-white/20 shrink-0"/>}
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] font-mono font-bold truncate ${th==='light'?'text-slate-600':'text-white/60'}`}>{user?.email}</p>
            <p className={`text-[10px] font-mono ${syncStatus==='syncing'?'text-blue-400':syncStatus==='synced'?'text-emerald-400':syncStatus==='error'?'text-red-400':'text-white/20'}`}>
              {syncStatus==='syncing'?'Syncing…':syncStatus==='synced'?'✓ Synced':syncStatus==='error'?'Sync error':'Cloud sync'}
            </p>
          </div>
          <button onClick={logOut} title="Sign out" className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0">
            <LogOut className="w-3.5 h-3.5"/>
          </button>
        </div>
        <div className="px-4 pb-3">
          {todayGoal ? (
            <div className={`rounded-xl p-3 border ${th==='light'?'bg-emerald-50 border-emerald-200':'bg-emerald-500/10 border-emerald-500/20'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] uppercase font-mono tracking-wider ${th==='light'?'text-emerald-700':'text-emerald-400'}`}>Today's Goal</span>
                <button onClick={()=>{setGoalInput(String(todayGoal.goal_hours));setShowGoalModal(true);}} className="text-[10px] text-white/30 hover:text-white/60">edit</button>
              </div>
              <p className={`font-black text-sm ${th==='light'?'text-emerald-800':'text-emerald-300'}`}>{todayGoal.goal_hours}h target</p>
              {goalInfo&&goalInfo.remainingSec>0&&<p className={`text-[10px] font-mono mt-0.5 ${th==='light'?'text-emerald-600':'text-emerald-400/70'}`}>Done by ~{goalInfo.time}</p>}
              {goalInfo&&goalInfo.remainingSec===0&&<p className="text-[10px] font-mono mt-0.5 text-emerald-400">✓ Goal achieved!</p>}
            </div>
          ) : (
            <button onClick={()=>setShowGoalModal(true)} className={`w-full py-2.5 border border-dashed rounded-xl text-xs font-bold ${th==='light'?'border-slate-300 text-slate-400 hover:text-slate-600':'border-white/10 text-white/20 hover:text-white/40'}`}>+ Set Today's Goal</button>
          )}
        </div>
        <div className={`p-4 border-t ${th==='light'?'border-slate-200':'border-white/5'}`}>
          <div className={`rounded-xl p-4 border ${th==='light'?'bg-slate-50 border-slate-200':'bg-white/5 border-white/5'}`}>
            <p className={`text-[10px] uppercase tracking-wider mb-1 font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>Active User</p>
            <p className="font-medium text-sm truncate">{settings.name}</p>
            <p className={`text-[10px] font-mono mt-1 ${th==='light'?'text-slate-300':'text-white/20'}`}>{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})}</p>
            <p className={`text-[10px] font-mono font-bold ${th==='light'?'text-slate-500':'text-white/40'}`}>{formatClock(now)}</p>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className={`h-14 md:h-16 border-b backdrop-blur-xl flex items-center justify-between px-4 md:px-8 shrink-0 gap-3 ${th==='light'?'bg-white/80 border-slate-200':'bg-[#0d0e11]/50 border-white/5'}`}>
          {/* Hamburger — mobile only */}
          <button className="md:hidden p-2 rounded-lg shrink-0" onClick={() => setSidebarOpen(true)}>
            <Menu className={`w-5 h-5 ${th==='light'?'text-slate-600':'text-white/60'}`}/>
          </button>
          {/* Stats row */}
          <div className="flex items-center gap-3 md:gap-6 overflow-x-auto flex-1 min-w-0">
            <div className="flex flex-col shrink-0">
              <span className={`text-[9px] md:text-[10px] uppercase tracking-wider font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>Studied</span>
              <span className={`text-xs md:text-sm font-bold font-mono ${th==='light'?'text-slate-700':'text-white/80'}`}>{formatTime(todayStats.total_seconds+(activeTaskState?.task?.category==='core'?displayTimer:0))}</span>
            </div>
            <div className={`h-7 w-px shrink-0 ${th==='light'?'bg-slate-200':'bg-white/5'}`}/>
            <div className="flex flex-col shrink-0">
              <span className={`text-[9px] md:text-[10px] uppercase tracking-wider font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>Left</span>
              <span className={`text-xs md:text-sm font-bold ${parseFloat(remainingHours())<1?'text-red-500':th==='light'?'text-blue-600':'text-blue-400'}`}>{remainingHours()}h{parseFloat(remainingHours())<0.5&&<AlertTriangle className="w-3 h-3 animate-bounce inline ml-1"/>}</span>
            </div>
            <div className={`h-7 w-px shrink-0 hidden sm:block ${th==='light'?'bg-slate-200':'bg-white/5'}`}/>
            <div className="hidden sm:flex flex-col shrink-0">
              <span className={`text-[9px] md:text-[10px] uppercase tracking-wider font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>Done By</span>
              <span className={`text-xs md:text-sm font-bold ${goalInfo&&goalInfo.remainingSec===0?'text-emerald-500':th==='light'?'text-slate-700':'text-white/80'}`}>{goalInfo?(goalInfo.remainingSec===0?'✓ Done!':goalInfo.time):'—'}</span>
            </div>
          </div>
          {/* Right: theme toggle + exam target */}
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <button onClick={toggleTheme} className={`p-2 rounded-lg transition-colors ${th==='light'?'bg-slate-100 text-slate-600 hover:bg-slate-200':'bg-white/5 text-white/60 hover:bg-white/10'}`}>{th==='light'?<Moon className="w-4 h-4"/>:<Sun className="w-4 h-4"/>}</button>
            <div className="hidden md:block text-right"><p className={`text-[10px] uppercase tracking-wider font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>Exam</p><p className="text-sm font-medium">{settings.exam_month}</p></div>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {/* ── Multi-Pause Queue — shown on every view ── */}
            {pausedTasks.length > 0 && (
              <PausedTasksShelf
                tasks={pausedTasks}
                timers={pausedTimers}
                onResume={resumeFromPausedList}
                onStop={stopPausedTask}
                theme={th}
              />
            )}

            {/* ── YouTube Live Class Alerts ── */}
            {ytAlerts.filter(a => !ytDismissed.has(a.id)).map(alert => (
              <motion.div key={alert.id} initial={{opacity:0,y:-12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}}
                className={`mb-4 border-2 rounded-2xl p-4 shadow-xl ${th==='light'?'bg-red-50 border-red-300':'bg-red-950/40 border-red-500/50'}`}>
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center shrink-0 shadow-lg">
                    <span className="text-white text-xl">▶</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${th==='light'?'bg-red-200 text-red-700':'bg-red-500/30 text-red-300'}`}>
                        LIVE CLASS DETECTED · {alert.timeStr}
                      </span>
                    </div>
                    <p className={`font-bold text-base leading-snug ${th==='light'?'text-slate-900':'text-white'}`}>
                      {alert.channelName} just uploaded — <span className="text-red-500">{alert.taskName}</span>
                    </p>
                    <p className={`text-sm mt-0.5 truncate ${th==='light'?'text-slate-600':'text-white/60'}`}>{alert.videoTitle}</p>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={() => { window.open(alert.videoUrl, '_blank'); handleYtStartTask(alert); }}
                        className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-500 transition-all flex items-center gap-1.5">
                        ▶ Open &amp; Start {alert.taskName} Timer
                      </button>
                      <button onClick={() => handleYtDismiss(alert.id)}
                        className={`px-3 py-2 text-sm rounded-xl transition-all ${th==='light'?'text-slate-400 hover:text-slate-600':'text-white/30 hover:text-white/60'}`}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {activeTaskState && !activeTaskState.paused_at && view === 'tasks' ? (
              <ActiveSession task={activeTaskState.task} timer={displayTimer} isOvertime={activeTaskState.is_overtime}
                isPaused={!!activeTaskState.paused_at} benchmark={benchmarks[activeTaskState.task.name]}
                startTimestamp={activeTaskState.start_timestamp} benchmarkBreached={benchmarkBreached}
                onStop={stopTask} onPause={pauseTask} onResumePause={resumeTaskFromPause} theme={th}/>
            ) : view==='tasks' ? (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard label="Today's Goal" value={todayGoal?`${todayGoal.goal_hours}h`:'Not set'} sub="Target" icon={<Target className="w-4 h-4 text-red-400"/>} theme={th} onClick={()=>{setGoalInput(String(todayGoal?.goal_hours??8));setShowGoalModal(true);}}/>
                  <StatCard label="Time Studied" value={formatTime(todayStats.total_seconds)} sub="Today" icon={<History className="w-4 h-4 text-purple-400"/>} theme={th}/>
                  <StatCard label="Overtime" value={todayStats.overtime_count.toString()} sub="Incidents" icon={<AlertTriangle className="w-4 h-4 text-red-400"/>} theme={th}/>
                </div>
                <button onClick={()=>setShowSampleTimer(true)} className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed text-sm font-medium transition-all ${th==='light'?'border-violet-300 text-violet-500 hover:bg-violet-50':'border-violet-500/30 text-violet-400 hover:bg-violet-500/10'}`}>
                  <FlaskConical className="w-4 h-4"/>Test Beep / Overtime Logic (Sample Timer — no data saved)
                </button>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold flex items-center gap-2"><Brain className="w-5 h-5 text-red-500"/>Core Study</h2>
                      <div className="flex items-center gap-3">
                        <button onClick={()=>setShowLibraryManager(true)} className={`text-[10px] font-mono uppercase tracking-widest flex items-center gap-1 px-2 py-1 rounded-lg border ${th==='light'?'border-slate-200 text-slate-500 hover:bg-slate-100':'border-white/10 text-white/30 hover:bg-white/5 hover:text-white/60'}`}><Settings className="w-3 h-3"/>Manage</button>
                        <button onClick={()=>setShowLibrary(true)} className={`text-[10px] font-mono uppercase tracking-widest flex items-center gap-1 ${th==='light'?'text-slate-400 hover:text-slate-900':'text-white/30 hover:text-white'}`}><History className="w-3 h-3"/>Library</button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {todayTasks.filter(t=>t.category==='core').map(task=>(
                        <TaskItem key={task.id} task={task} benchmark={benchmarks[task.name]} isCompleted={completedIds.has(task.id)} isEditing={editingTaskId===task.id} reminder={reminders.find(r=>r.task_id===task.id)} lastStopped={lastStoppedTasks[task.id]}
                          onStart={()=>startTask(task)}
                          onContinue={lastStoppedTasks[task.id]?()=>continueTask(lastStoppedTasks[task.id]):completedIds.has(task.id)?()=>continueCompletedTask(task):undefined}
                          onRemove={()=>removeFromToday(task.id)} onEdit={()=>setEditingTaskId(editingTaskId===task.id?null:task.id)} onSaveEdit={c=>handleEditTask(task.id,c)}
                          onSetReminder={()=>{setShowReminderFor(task);setReminderInput(reminders.find(r=>r.task_id===task.id)?.time??'');}} onToggleReminder={()=>toggleReminder(task.id)} theme={th}/>
                      ))}
                      <AddTaskInline category="core" newTask={newTask} setNewTask={setNewTask} onAdd={handleAddTask} theme={th} library={library}/>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2"><User className="w-5 h-5 text-blue-500"/>Life Tasks</h2>
                    <div className="space-y-3">
                      {todayTasks.filter(t=>t.category==='life').map(task=>(
                        <TaskItem key={task.id} task={task} benchmark={benchmarks[task.name]} isCompleted={completedIds.has(task.id)} isEditing={editingTaskId===task.id} reminder={reminders.find(r=>r.task_id===task.id)} lastStopped={lastStoppedTasks[task.id]}
                          onStart={()=>startTask(task)}
                          onContinue={lastStoppedTasks[task.id]?()=>continueTask(lastStoppedTasks[task.id]):completedIds.has(task.id)?()=>continueCompletedTask(task):undefined}
                          onRemove={()=>removeFromToday(task.id)} onEdit={()=>setEditingTaskId(editingTaskId===task.id?null:task.id)} onSaveEdit={c=>handleEditTask(task.id,c)}
                          onSetReminder={()=>{setShowReminderFor(task);setReminderInput(reminders.find(r=>r.task_id===task.id)?.time??'');}} onToggleReminder={()=>toggleReminder(task.id)} theme={th}/>
                      ))}
                      <AddTaskInline category="life" newTask={newTask} setNewTask={setNewTask} onAdd={handleAddTask} theme={th} library={library}/>
                    </div>
                  </div>
                </div>
              </div>
            ) : view==='analytics' ? (<AnalyticsView weeklyStats={weeklyStats} subjectStats={subjectStats} timelineStats={timelineStats} lifeWeeklyStats={lifeWeeklyStats} lifeTaskStats={lifeTaskStats} theme={th} onDeleteLog={handleDeleteLog}/>)
              : view==='benchmarks' ? (<BenchmarksView benchmarks={Object.values(benchmarks)} theme={th} onDeleteBenchmark={handleDeleteBenchmark}/>)
              : (<SettingsView formData={formData} setFormData={setFormData} onSave={handleSaveSettings} theme={th}/>)}
          </div>
        </div>
      </main>

      {/* ── Library Modal ── */}
      <AnimatePresence>
        {showLibrary&&(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowLibrary(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm"/>
            <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}} className={`relative border rounded-2xl p-8 max-w-lg w-full shadow-2xl ${th==='light'?'bg-white border-slate-200 text-slate-900':'bg-[#1c1d21] border-white/10 text-white'}`}>
              <div className="flex items-center justify-between mb-6"><h2 className="text-xl font-bold">Task Library</h2><button onClick={()=>setShowLibrary(false)} className={th==='light'?'text-slate-400 hover:text-slate-900':'text-white/40 hover:text-white'}><XCircle className="w-5 h-5"/></button></div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                {library.length===0&&<p className={`text-center py-8 ${th==='light'?'text-slate-400':'text-white/20'}`}>No tasks in library yet.</p>}
                {library.map(task=>{
                  const isAdded=getTodayTaskIds().includes(task.id);
                  return(<div key={task.id} className={`rounded-xl p-4 flex items-center justify-between border ${th==='light'?'bg-slate-50 border-slate-100':'bg-white/5 border-white/5'}`}>
                    <div><p className="font-medium text-sm">{task.name}</p><p className={`text-[10px] uppercase tracking-wider font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>{task.category} · {task.type}{task.standard_minutes?` · ${task.standard_minutes}m`:''}</p></div>
                    <button disabled={isAdded} onClick={()=>{addToToday(task.id);setShowLibrary(false);}} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${isAdded?'bg-emerald-500/20 text-emerald-500 cursor-default':th==='light'?'bg-slate-900 text-white hover:bg-slate-800':'bg-white text-black hover:bg-white/90'}`}>{isAdded?'Added':'Add to Today'}</button>
                  </div>);
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Overtime Modal ── */}
      <AnimatePresence>
        {showOvertimeModal&&activeTaskState&&(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
            <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}} className={`relative border rounded-2xl p-8 max-w-md w-full shadow-2xl ${th==='light'?'bg-white border-red-300 text-slate-900':'bg-[#1c1d21] border-red-500/30 shadow-[0_0_50px_rgba(220,38,38,0.25)] text-white'}`}>
              <div className="flex items-center gap-3 text-red-500 mb-4"><AlertTriangle className="w-8 h-8"/><h2 className="text-2xl font-bold uppercase tracking-wide">Rigor Breach</h2></div>
              {settings.exam_month&&(()=>{
                const dd=Math.ceil((new Date(settings.exam_month+'-01').getTime()-Date.now())/(864e5));
                return dd>0?(<div className={`rounded-xl p-3 mb-4 flex items-center gap-3 border ${th==='light'?'bg-amber-50 border-amber-200':'bg-amber-500/10 border-amber-500/20'}`}><Calendar className="w-5 h-5 text-amber-500 shrink-0"/><p className={`text-sm font-mono font-medium ${th==='light'?'text-amber-800':'text-amber-300'}`}><span className="font-black text-xl">{dd}</span> days · <span className="font-black text-xl">{Math.max(0,Math.floor(dd/30))}</span> months left</p></div>):null;
              })()}
              <div className={`rounded-xl p-4 mb-5 border ${th==='light'?'bg-red-50 border-red-200':'bg-red-500/10 border-red-500/20'}`}><p className={`text-sm italic font-serif leading-relaxed ${th==='light'?'text-red-700':'text-red-300'}`}>"{settings.negative_motivation}"</p></div>
              <div className="space-y-3">
                <p className={`text-sm ${th==='light'?'text-slate-600':'text-white/60'}`}>Exceeded standard time on <strong>{activeTaskState.task.name}</strong>. State why:</p>
                <textarea className={`w-full border rounded-xl py-3 px-4 h-20 focus:outline-none resize-none text-sm ${th==='light'?'bg-slate-50 border-slate-300 text-slate-900 focus:border-red-400':'bg-black/40 border-white/10 text-white focus:border-red-500/50'}`} placeholder="Why did you go overtime?" value={overtimeReason} onChange={e=>setOvertimeReason(e.target.value)}/>
                <button onClick={()=>commitLog(overtimeReason)} disabled={!overtimeReason.trim()} className="w-full bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-500 disabled:opacity-40">LOG & CONTINUE</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>{showSampleTimer&&<SampleTimerModal theme={th} negMotivation={settings.negative_motivation} examMonth={settings.exam_month} onClose={()=>setShowSampleTimer(false)}/>}</AnimatePresence>

      {/* ── Reminder Modal ── */}
      <AnimatePresence>
        {showReminderFor&&(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowReminderFor(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm"/>
            <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} className={`relative border rounded-2xl p-6 max-w-sm w-full shadow-xl ${th==='light'?'bg-white border-slate-200 text-slate-900':'bg-[#1c1d21] border-white/10 text-white'}`}>
              <h3 className="font-bold text-lg mb-1 flex items-center gap-2"><Bell className="w-5 h-5 text-amber-400"/>Set Reminder</h3>
              <p className={`text-xs mb-4 font-mono ${th==='light'?'text-slate-400':'text-white/40'}`}>{showReminderFor.name}</p>
              <input type="time" className={`w-full border rounded-xl py-3 px-4 text-2xl font-mono font-bold mb-4 focus:outline-none ${th==='light'?'bg-slate-50 border-slate-300 text-slate-900':'bg-black/40 border-white/20 text-white'}`} value={reminderInput} onChange={e=>setReminderInput(e.target.value)}/>
              <div className="flex gap-3">
                {reminders.find(r=>r.task_id===showReminderFor.id)&&<button onClick={()=>{deleteReminder(showReminderFor!.id);setShowReminderFor(null);}} className={`px-4 py-2 rounded-xl text-xs font-bold ${th==='light'?'bg-red-50 text-red-500':'bg-red-500/10 text-red-400'}`}>Remove</button>}
                <button onClick={()=>setShowReminderFor(null)} className={`flex-1 py-2 rounded-xl text-sm font-medium ${th==='light'?'bg-slate-100 text-slate-600':'bg-white/10 text-white/60'}`}>Cancel</button>
                <button onClick={()=>reminderInput&&handleSetReminder(showReminderFor!,reminderInput)} disabled={!reminderInput} className="flex-1 py-2 rounded-xl text-sm font-bold bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-40">Set Alarm</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>{showLibraryManager&&<LibraryManagerModal theme={th} onClose={()=>{setShowLibraryManager(false);reload();}}/>}</AnimatePresence>
    </div>
    </>
  );
}

// ─── PausedTasksShelf ─────────────────────────────────────────────────────────
function PausedTasksShelf({tasks,timers,onResume,onStop,theme}:{
  tasks:ActiveTaskState[];timers:Record<number,number>;
  onResume:(s:ActiveTaskState)=>void;onStop:(s:ActiveTaskState)=>void;theme?:string;
}) {
  return (
    <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}
      className={`mb-6 border rounded-2xl overflow-hidden shadow-lg ${theme==='light'?'bg-blue-50 border-blue-300':'bg-blue-500/10 border-blue-500/40'}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${theme==='light'?'border-blue-200 bg-blue-100':'border-blue-500/30 bg-blue-500/10'}`}>
        <Pause className="w-4 h-4 text-blue-400"/>
        <span className={`text-xs font-bold uppercase tracking-widest font-mono ${theme==='light'?'text-blue-700':'text-blue-300'}`}>
          Paused Queue — {tasks.length} task{tasks.length>1?'s':''} waiting
        </span>
      </div>
      <div className="divide-y divide-blue-500/10">
        {tasks.map((s) => {
          const elapsed = timers[s.start_timestamp] ?? 0;
          return (
            <div key={s.start_timestamp} className="flex items-center gap-3 px-4 py-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${s.task.type==='standard'?'bg-red-500/10 text-red-400':'bg-blue-500/10 text-blue-400'}`}>
                <Pause className="w-3.5 h-3.5"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${theme==='light'?'text-slate-900':'text-white'}`}>{s.task.name}</p>
                <p className={`text-xs font-mono ${theme==='light'?'text-slate-500':'text-white/50'}`}>{formatTime(elapsed)} elapsed · paused time excluded</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={()=>onResume(s)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-500 text-white hover:bg-blue-400 transition-all">
                  <Play className="w-3 h-3 fill-current"/>Resume
                </button>
                <button onClick={()=>onStop(s)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${theme==='light'?'bg-slate-200 text-slate-700 hover:bg-slate-300':'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                  <Square className="w-3 h-3 fill-current"/>Log
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({icon,label,active,onClick,theme}:{icon:React.ReactNode;label:string;active:boolean;onClick:()=>void;theme?:string}) {
  return <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active?(theme==='light'?'bg-slate-100 text-slate-900':'bg-white/10 text-white'):(theme==='light'?'text-slate-400 hover:text-slate-900 hover:bg-slate-50':'text-white/40 hover:text-white hover:bg-white/5')}`}>{icon}<span className="text-sm font-medium">{label}</span></button>;
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({label,value,sub,icon,theme,onClick}:{label:string;value:string;sub:string;icon:React.ReactNode;theme?:string;onClick?:()=>void}) {
  return <div onClick={onClick} className={`border rounded-2xl p-5 group transition-colors ${onClick?'cursor-pointer':''} ${theme==='light'?'bg-white border-slate-200 hover:border-slate-300':'bg-[#1c1d21] border-white/5 hover:border-white/10'}`}><div className="flex items-center justify-between mb-3"><span className={`text-[10px] uppercase tracking-widest font-mono ${theme==='light'?'text-slate-400':'text-white/30'}`}>{label}</span>{icon}</div><div className="flex items-baseline gap-2"><span className="text-2xl font-bold tracking-tight">{value}</span><span className={`text-[10px] font-mono uppercase ${theme==='light'?'text-slate-300':'text-white/20'}`}>{sub}</span></div></div>;
}

// ─── TaskItem ─────────────────────────────────────────────────────────────────
function TaskItem({task,benchmark,isCompleted,isEditing,reminder,lastStopped,onStart,onContinue,onRemove,onEdit,onSaveEdit,onSetReminder,onToggleReminder,theme}:{
  task:Task;benchmark?:Benchmark;isCompleted:boolean;isEditing:boolean;reminder?:TaskReminder;lastStopped?:LastStoppedInfo;
  onStart:()=>void;onContinue?:()=>void;onRemove:()=>void;onEdit:()=>void;onSaveEdit:(c:Partial<Task>)=>void;onSetReminder:()=>void;onToggleReminder:()=>void;theme?:string;
}) {
  const [editName,setEditName]=useState(task.name);
  const [editType,setEditType]=useState<'standard'|'normal'>(task.type);
  const [editMins,setEditMins]=useState(task.standard_minutes??30);
  useEffect(()=>{ if(isEditing){setEditName(task.name);setEditType(task.type);setEditMins(task.standard_minutes??30);} },[isEditing]);
  const inp=`border rounded-lg py-1.5 px-3 text-xs focus:outline-none ${theme==='light'?'bg-slate-50 border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`;
  if(isEditing) return(
    <div className={`border rounded-xl p-4 space-y-3 ${theme==='light'?'bg-blue-50 border-blue-200':'bg-blue-500/10 border-blue-500/20'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${theme==='light'?'text-blue-700':'text-blue-300'}`}>Editing Task</p>
      <input className={`w-full ${inp} text-sm`} value={editName} onChange={e=>setEditName(e.target.value)}/>
      <div className="flex gap-2">
        <select className={`flex-1 ${inp}`} value={editType} onChange={e=>setEditType(e.target.value as any)}><option value="normal">Normal (Benchmark)</option><option value="standard">Standard (Timer + Alert)</option></select>
        {editType==='standard'&&<input type="number" className={`w-20 ${inp}`} value={editMins} onChange={e=>setEditMins(parseInt(e.target.value)||30)}/>}
      </div>
      <div className="flex gap-2">
        <button onClick={onEdit} className={`flex-1 text-xs py-2 rounded-lg ${theme==='light'?'bg-slate-100 text-slate-600':'bg-white/10 text-white/60'}`}>Cancel</button>
        <button onClick={()=>onSaveEdit({name:editName.trim()||task.name,type:editType,standard_minutes:editType==='standard'?editMins:undefined})} className="flex-1 text-xs py-2 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center gap-1"><Save className="w-3 h-3"/>Save</button>
      </div>
    </div>
  );
  return(
    <div className={`border rounded-xl p-3 group transition-all ${theme==='light'?'bg-white border-slate-200 hover:border-slate-300':'bg-[#1c1d21] border-white/5 hover:border-white/10'} ${isCompleted?'opacity-50 grayscale':''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${task.type==='standard'?'bg-red-500/10 text-red-500':'bg-blue-500/10 text-blue-500'}`}>
          {isCompleted?<CheckCircle2 className="w-4 h-4 text-emerald-500"/>:task.type==='standard'?<Clock className="w-4 h-4"/>:<TrendingUp className="w-4 h-4"/>}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isCompleted?'line-through opacity-50':''}`}>{task.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[10px] font-mono uppercase ${theme==='light'?'text-slate-400':'text-white/30'}`}>{task.type}{task.standard_minutes?` · ${task.standard_minutes}m`:''}</span>
            {benchmark&&benchmark.sessions>0&&<span className="text-[10px] font-mono text-emerald-500">Benchmark:{formatTime(benchmark.best_seconds)}</span>}
            {!benchmark&&task.type==='normal'&&<span className={`text-[10px] font-mono ${theme==='light'?'text-amber-500':'text-amber-400'}`}>First run sets benchmark</span>}
            {reminder&&<span className={`text-[10px] font-mono flex items-center gap-0.5 ${reminder.enabled?'text-amber-400':'text-white/20'}`}><Bell className="w-2.5 h-2.5"/>{reminder.time}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          {!isCompleted&&<button onClick={onStart} title="Start fresh" className={`p-1.5 rounded-lg ${theme==='light'?'hover:bg-slate-900 hover:text-white text-slate-500':'hover:bg-white hover:text-black text-white/50'}`}><Play className="w-3.5 h-3.5 fill-current"/></button>}
          <button onClick={onEdit} className={`p-1.5 rounded-lg ${theme==='light'?'hover:bg-blue-100 text-slate-400 hover:text-blue-600':'hover:bg-blue-500/20 text-white/30 hover:text-blue-400'}`}><Pencil className="w-3.5 h-3.5"/></button>
          <button onClick={onSetReminder} className={`p-1.5 rounded-lg ${reminder?.enabled?'text-amber-400':theme==='light'?'text-slate-400 hover:text-amber-500':'text-white/30 hover:text-amber-400'}`}><Bell className="w-3.5 h-3.5"/></button>
          <button onClick={onRemove} className={`p-1.5 rounded-lg ${theme==='light'?'hover:bg-red-100 text-slate-400 hover:text-red-500':'hover:bg-red-500/20 text-white/30 hover:text-red-400'}`}><XCircle className="w-3.5 h-3.5"/></button>
        </div>
      </div>
      {/* Continue button — shown when task was recently stopped OR completed today */}
      {onContinue && (
        <div className={`mt-2 pt-2 border-t flex items-center gap-2 ${theme==='light'?'border-slate-100':'border-white/5'}`}>
          <span className={`text-[10px] font-mono ${theme==='light'?'text-slate-400':'text-white/30'}`}>
            {lastStopped ? `Last stop: ${formatTime(lastStopped.elapsed_seconds)}` : isCompleted ? 'Completed today — continue adding time' : ''}
          </span>
          <button onClick={onContinue}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${theme==='light'?'bg-emerald-100 text-emerald-700 hover:bg-emerald-200':'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'}`}>
            <Play className="w-3 h-3 fill-current"/>
            {lastStopped ? `Continue from ${formatTime(lastStopped.elapsed_seconds)}` : 'Continue Task'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AddTaskInline ────────────────────────────────────────────────────────────
function AddTaskInline({category,newTask,setNewTask,onAdd,theme,library}:{category:'core'|'life';newTask:any;setNewTask:(t:any)=>void;onAdd:()=>void;theme?:string;library:Task[]}) {
  const [open,setOpen]=useState(false);
  const [mode,setMode]=useState<'type'|'pick'>('pick');
  const lib=library;
  if(!open) return <button onClick={()=>{setOpen(true);setNewTask({...newTask,category});}} className={`w-full border border-dashed rounded-xl py-3 flex items-center justify-center gap-2 text-sm font-medium transition-all ${theme==='light'?'border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300':'border-white/10 text-white/20 hover:text-white/40 hover:border-white/20'}`}><Plus className="w-4 h-4"/>Add {category==='core'?'Study':'Life'} Task</button>;
  const inp=`w-full border rounded-lg py-2 px-3 text-sm focus:outline-none transition-colors ${theme==='light'?'bg-slate-50 border-slate-200 focus:border-slate-400 text-slate-900':'bg-black/40 border-white/10 focus:border-white/30 text-white'}`;
  return(
    <div className={`border rounded-xl p-4 space-y-3 ${theme==='light'?'bg-white border-slate-300 shadow-sm':'bg-[#1c1d21] border-white/20'}`}>
      <div className={`flex rounded-lg p-0.5 gap-0.5 ${theme==='light'?'bg-slate-100':'bg-black/30'}`}>
        {(['pick','type'] as const).map(m=>(<button key={m} onClick={()=>setMode(m)} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${mode===m?(theme==='light'?'bg-white text-slate-900 shadow-sm':'bg-white/10 text-white'):(theme==='light'?'text-slate-400':'text-white/30')}`}>{m==='pick'?'Select from List':'Type Name'}</button>))}
      </div>
      {mode==='pick'?(
        <select className={inp} value={newTask.name} onChange={e=>{const t=lib.find(x=>x.name===e.target.value);if(t)setNewTask({...t});else setNewTask({...newTask,name:e.target.value});}}>
          <option value="">— choose a task —</option>
          {lib.filter(t=>t.category===category).map(t=>(<option key={t.id} value={t.name}>{t.name}{t.standard_minutes?` (${t.standard_minutes}m)`:''}</option>))}
        </select>
      ):(
        <input autoFocus className={inp} placeholder="Task name..." value={newTask.name} onChange={e=>setNewTask({...newTask,name:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&newTask.name.trim()){onAdd();setOpen(false);}}}/>
      )}
      {mode==='type'&&(
        <div className="flex gap-2">
          <select className={`flex-1 border rounded-lg py-2 px-3 text-xs focus:outline-none ${theme==='light'?'bg-slate-50 border-slate-200 text-slate-900':'bg-black/40 border-white/10 text-white'}`} value={newTask.type} onChange={e=>setNewTask({...newTask,type:e.target.value})}>
            <option value="normal">Normal (Benchmark)</option><option value="standard">Standard (Timer + Alert)</option>
          </select>
          {newTask.type==='standard'&&<input type="number" min="1" className={`w-20 border rounded-lg py-2 px-3 text-xs focus:outline-none ${theme==='light'?'bg-slate-50 border-slate-200 text-slate-900':'bg-black/40 border-white/10 text-white'}`} placeholder="Min" value={newTask.standard_minutes} onChange={e=>setNewTask({...newTask,standard_minutes:parseInt(e.target.value)||30})}/>}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={()=>setOpen(false)} className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${theme==='light'?'text-slate-400 hover:text-slate-900':'text-white/40 hover:text-white'}`}>Cancel</button>
        <button onClick={()=>{if(newTask.name.trim()){onAdd();setOpen(false);}}} disabled={!newTask.name.trim()} className={`flex-1 text-xs font-bold py-2 rounded-lg disabled:opacity-40 ${theme==='light'?'bg-slate-900 text-white hover:bg-slate-800':'bg-white text-black hover:bg-white/90'}`}>Add to Today</button>
      </div>
    </div>
  );
}

// ─── ActiveSession ────────────────────────────────────────────────────────────
function ActiveSession({task,timer,isOvertime,isPaused,benchmark,startTimestamp,benchmarkBreached,onStop,onPause,onResumePause,theme}:{
  task:Task;timer:number;isOvertime:boolean;isPaused:boolean;benchmark?:Benchmark;startTimestamp:number;benchmarkBreached:boolean;
  onStop:()=>void;onPause:()=>void;onResumePause:()=>void;theme?:string;
}) {
  const diff = benchmark ? timer - benchmark.best_seconds : 0;
  const alertState = isOvertime?'overtime':benchmarkBreached?'benchmark':isPaused?'paused':'active';
  const startedAt = new Date(startTimestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});

  useEffect(() => {
    const fn = (e:KeyboardEvent) => { if(e.key==='Enter'&&!isPaused) onStop(); };
    window.addEventListener('keydown',fn);
    return () => window.removeEventListener('keydown',fn);
  },[onStop,isPaused]);

  const statusLabel = alertState==='overtime'?'⚠ Overtime Breach':alertState==='benchmark'?'⚡ Benchmark Exceeded':alertState==='paused'?'⏸ Session Paused':'● Session Active';
  const statusColor = alertState==='overtime'?'border-red-500 text-red-500 bg-red-500/10':alertState==='benchmark'?'border-amber-500 text-amber-500 bg-amber-500/10':alertState==='paused'?'border-blue-400 text-blue-400 bg-blue-400/10':'border-emerald-500 text-emerald-500 bg-emerald-500/10';
  const timerColor = alertState==='overtime'?'text-red-500':alertState==='benchmark'?'text-amber-400':alertState==='paused'?(theme==='light'?'text-blue-500 opacity-60':'text-blue-400 opacity-60'):'';

  return(
    <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} className={`max-w-2xl mx-auto border rounded-3xl p-12 text-center shadow-2xl relative overflow-hidden ${theme==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/10'}`}>
      {isOvertime&&<div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none"/>}
      {!isOvertime&&benchmarkBreached&&!isPaused&&<div className="absolute inset-0 bg-amber-500/5 animate-pulse pointer-events-none"/>}
      {isPaused&&<div className="absolute inset-0 bg-blue-500/5 pointer-events-none"/>}
      <div className="mb-8">
        <span className={`text-[10px] font-mono uppercase tracking-[0.3em] px-3 py-1 rounded-full border ${statusColor}`}>{statusLabel}</span>
        <h2 className="text-4xl font-bold tracking-tight mt-6 mb-2">{task.name}</h2>
        <p className={`text-sm font-mono uppercase tracking-widest ${theme==='light'?'text-slate-400':'text-white/40'}`}>{task.category} · Started {startedAt}{isPaused&&<span className="ml-2 text-blue-400">· Paused</span>}</p>
      </div>

      {/* Timer — frozen when paused because computeEffectiveElapsed uses paused_at */}
      <div className={`text-8xl font-black tracking-tighter font-mono mb-6 tabular-nums ${timerColor}`}>{formatTime(timer)}</div>

      {benchmark&&(
        <div className="mb-8 flex items-center justify-center">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider ${diff>0?'bg-red-500/10 text-red-500':'bg-emerald-500/10 text-emerald-500'}`}>
            {diff>0?'▲':'▼'} {diff>0?'+':''}{formatTime(Math.abs(diff))} vs Best ({benchmark.sessions} sessions)
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-6 mb-12">
        <div className={`rounded-2xl p-4 border ${theme==='light'?'bg-slate-50 border-slate-100':'bg-black/40 border-white/5'}`}><p className={`text-[10px] uppercase tracking-wider mb-1 font-mono ${theme==='light'?'text-slate-400':'text-white/30'}`}>Best Benchmark</p><p className="text-lg font-bold">{benchmark?formatTime(benchmark.best_seconds):'--:--'}</p></div>
        <div className={`rounded-2xl p-4 border ${theme==='light'?'bg-slate-50 border-slate-100':'bg-black/40 border-white/5'}`}><p className={`text-[10px] uppercase tracking-wider mb-1 font-mono ${theme==='light'?'text-slate-400':'text-white/30'}`}>Standard Limit</p><p className="text-lg font-bold">{task.standard_minutes?`${task.standard_minutes}m`:'None'}</p></div>
      </div>

      {/* ── Pause / Resume + Stop ── */}
      <div className="flex items-center justify-center gap-6">
        {/* Pause — sends task to the paused queue; hidden during overtime */}
        {!isOvertime&&(
          <button onClick={onPause}
            title="Pause — task goes to the Paused Queue, you can start another task and come back"
            className={`group relative w-16 h-16 rounded-full flex items-center justify-center hover:scale-110 transition-all active:scale-95 shadow-lg ${
              theme==='light'?'bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-600':'bg-white/10 text-white/60 hover:bg-blue-500/20 hover:text-blue-400'
            }`}>
            <Pause className="w-6 h-6"/>
            <span className={`absolute -bottom-7 text-[10px] font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ${theme==='light'?'text-slate-400':'text-white/40'}`}>Pause</span>
          </button>
        )}
        {/* Stop */}
        <button onClick={onStop} title={isPaused?'Stop (paused time excluded from log)':'Stop (or press Enter)'}
          className={`group relative w-24 h-24 rounded-full flex items-center justify-center hover:scale-110 transition-all active:scale-95 shadow-xl ${theme==='light'?'bg-slate-900 text-white':'bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.2)]'}`}>
          <Square className="w-8 h-8 fill-current"/>
          <span className={`absolute -bottom-8 text-[10px] font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ${theme==='light'?'text-slate-400':'text-white/40'}`}>{isPaused?'Stop':'Enter to Stop'}</span>
        </button>
      </div>

      {alertState==='overtime'&&<motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} className="mt-14 flex items-center justify-center gap-2 text-red-500 font-mono text-xs animate-bounce"><AlertTriangle className="w-4 h-4"/>WARNING: STANDARD TIME BREACHED</motion.div>}
      {alertState==='benchmark'&&<motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} className="mt-14 flex items-center justify-center gap-2 text-amber-400 font-mono text-xs animate-bounce"><AlertTriangle className="w-4 h-4"/>BENCHMARK EXCEEDED — PUSH HARDER</motion.div>}
      {alertState==='paused'&&<motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} className="mt-14 flex items-center justify-center gap-2 text-blue-400 font-mono text-xs"><Pause className="w-4 h-4"/>TIMER PAUSED — Click ▶ to resume</motion.div>}
    </motion.div>
  );
}

// ─── AnalyticsView ────────────────────────────────────────────────────────────
function AnalyticsView({weeklyStats,subjectStats,timelineStats,lifeWeeklyStats,lifeTaskStats,theme,onDeleteLog}:{weeklyStats:any[];subjectStats:any[];timelineStats:any[];lifeWeeklyStats:any[];lifeTaskStats:any[];theme?:string;onDeleteLog:(id:string)=>void}) {
  const COLORS=['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899'];
  const LIFE_COLORS=['#06b6d4','#84cc16','#f97316','#a78bfa','#fb7185','#34d399'];
  const [analyticsTab, setAnalyticsTab] = useState<'core'|'life'>('core');
  const total=weeklyStats.reduce((a,d)=>a+d.total_seconds,0);
  const avg=weeklyStats.length?total/weeklyStats.length:0;
  // core-only 30-day history
  const allCore=getLogs().filter(l=>l.category==='core'); const dgCore:Record<string,number>={};
  allCore.forEach(l=>{ dgCore[l.date]=(dgCore[l.date]||0)+l.duration_seconds; });
  const last30=Object.entries(dgCore).sort((a,b)=>a[0].localeCompare(b[0])).slice(-30).map(([date,ts])=>({date:date.slice(5),total_seconds:ts}));
  // life stats
  const lifeTotal=lifeWeeklyStats.reduce((a,d)=>a+d.total_seconds,0);
  const lifeAvg=lifeWeeklyStats.length?lifeTotal/lifeWeeklyStats.length:0;
  const allLife=getLogs().filter(l=>l.category==='life'); const dgLife:Record<string,number>={};
  allLife.forEach(l=>{ dgLife[l.date]=(dgLife[l.date]||0)+l.duration_seconds; });
  const life30=Object.entries(dgLife).sort((a,b)=>a[0].localeCompare(b[0])).slice(-30).map(([date,ts])=>({date:date.slice(5),total_seconds:ts}));
  const coreTimelineToday = timelineStats.filter(l=>l.category==='core');
  const lifeTimelineToday = timelineStats.filter(l=>l.category==='life');
  const th = theme;
  const tabBtn = (active:boolean) => `px-4 py-2 text-xs font-mono uppercase tracking-widest rounded-xl transition-all ${active?(th==='light'?'bg-slate-900 text-white':'bg-white text-black'):(th==='light'?'text-slate-500 hover:text-slate-800':'text-white/40 hover:text-white/70')}`;
  return(
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className={`flex gap-2 p-1 rounded-2xl w-fit ${th==='light'?'bg-slate-100':'bg-white/5'}`}>
        <button className={tabBtn(analyticsTab==='core')} onClick={()=>setAnalyticsTab('core')}>📚 Study (Core)</button>
        <button className={tabBtn(analyticsTab==='life')} onClick={()=>setAnalyticsTab('life')}>🌿 Life Tasks</button>
      </div>

      {analyticsTab==='core' ? (
        <div className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="This Week" value={formatTime(total)} sub="Core Only" icon={<TrendingUp className="w-4 h-4 text-emerald-400"/>} theme={th}/>
            <StatCard label="Daily Avg" value={formatTime(Math.round(avg))} sub="Avg" icon={<Clock className="w-4 h-4 text-blue-400"/>} theme={th}/>
            <StatCard label="Subjects" value={subjectStats.length.toString()} sub="Tracked" icon={<BookOpen className="w-4 h-4 text-purple-400"/>} theme={th}/>
            <StatCard label="Today" value={formatTime(coreTimelineToday.reduce((a,l)=>a+l.duration_seconds,0))} sub="Core Sessions" icon={<Brain className="w-4 h-4 text-red-400"/>} theme={th}/>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">7-Day Study Trend (Core)</h3>
              <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={weeklyStats}><CartesianGrid strokeDasharray="3 3" stroke={th==='light'?'#e2e8f0':'#ffffff10'}/><XAxis dataKey="date" stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10}/><YAxis stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10} tickFormatter={v=>formatTime(v)}/><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any)=>[formatTime(v),'Study Time']}/><Bar dataKey="total_seconds" fill="#ef4444" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
            </div>
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">Subject Distribution (All Time)</h3>
              {subjectStats.length===0?<div className={`h-56 flex items-center justify-center text-sm font-mono ${th==='light'?'text-slate-400':'text-white/20'}`}>No core study logged yet</div>:(
                <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={subjectStats} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="total_seconds" nameKey="subject">{subjectStats.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any,_:any,p:any)=>[formatTime(v),p.payload.subject]}/></PieChart></ResponsiveContainer></div>
              )}
            </div>
          </div>
          {last30.length>0&&(
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">30-Day Study History (Core)</h3>
              <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={last30}><CartesianGrid strokeDasharray="3 3" stroke={th==='light'?'#e2e8f0':'#ffffff10'}/><XAxis dataKey="date" stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={9} interval={4}/><YAxis stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10} tickFormatter={v=>formatTime(v)}/><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any)=>[formatTime(v),'Study Time']}/><Bar dataKey="total_seconds" fill="#3b82f6" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
            </div>
          )}
          <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
            <h3 className="text-sm font-bold uppercase tracking-widest mb-4 font-mono">Today's Core Session Log</h3>
            {coreTimelineToday.length===0?<p className={`text-sm font-mono ${th==='light'?'text-slate-400':'text-white/20'}`}>No core sessions logged today yet.</p>:(
              <div className="space-y-2">{coreTimelineToday.map((l,i)=>(
                <div key={l.id} className={`flex items-center gap-4 p-3 rounded-xl border group ${th==='light'?'bg-slate-50 border-slate-100':'bg-white/5 border-white/5'}`}>
                  <span className={`text-[10px] font-mono w-5 text-center ${th==='light'?'text-slate-400':'text-white/30'}`}>{i+1}</span>
                  <div className="w-2 h-8 rounded-full bg-red-500"/>
                  <div className="flex-1"><p className="text-sm font-medium">{l.task_name}</p><p className={`text-[10px] font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>core · {new Date(l.logged_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</p></div>
                  <span className={`font-mono font-bold text-sm ${l.is_overtime?'text-red-500':'text-emerald-500'}`}>{formatTime(l.duration_seconds)}</span>
                  {l.is_overtime&&<span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-mono">OT</span>}
                  <button onClick={()=>{ if(confirm(`Delete log entry for "${l.task_name}"?`)) onDeleteLog(l.id); }} className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all ${th==='light'?'hover:bg-red-100 text-slate-400 hover:text-red-500':'hover:bg-red-500/20 text-white/20 hover:text-red-400'}`} title="Delete this log entry"><XCircle className="w-4 h-4"/></button>
                </div>
              ))}</div>
            )}
          </div>
        </div>
      ) : (
        /* ── Life Tasks Analytics ── */
        <div className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="This Week" value={formatTime(lifeTotal)} sub="Life Tasks" icon={<TrendingUp className="w-4 h-4 text-cyan-400"/>} theme={th}/>
            <StatCard label="Daily Avg" value={formatTime(Math.round(lifeAvg))} sub="Avg" icon={<Clock className="w-4 h-4 text-lime-400"/>} theme={th}/>
            <StatCard label="Today" value={formatTime(lifeTimelineToday.reduce((a,l)=>a+l.duration_seconds,0))} sub="Life Sessions" icon={<Brain className="w-4 h-4 text-orange-400"/>} theme={th}/>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">7-Day Life Task Trend</h3>
              {lifeTotal===0?<div className={`h-56 flex items-center justify-center text-sm font-mono ${th==='light'?'text-slate-400':'text-white/20'}`}>No life tasks logged this week</div>:(
                <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={lifeWeeklyStats}><CartesianGrid strokeDasharray="3 3" stroke={th==='light'?'#e2e8f0':'#ffffff10'}/><XAxis dataKey="date" stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10}/><YAxis stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10} tickFormatter={v=>formatTime(v)}/><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any)=>[formatTime(v),'Life Task Time']}/><Bar dataKey="total_seconds" fill="#06b6d4" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
              )}
            </div>
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">Task Distribution (All Time)</h3>
              {lifeTaskStats.length===0?<div className={`h-56 flex items-center justify-center text-sm font-mono ${th==='light'?'text-slate-400':'text-white/20'}`}>No life tasks logged yet</div>:(
                <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={lifeTaskStats} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="total_seconds" nameKey="task">{lifeTaskStats.map((_,i)=><Cell key={i} fill={LIFE_COLORS[i%LIFE_COLORS.length]}/>)}</Pie><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any,_:any,p:any)=>[formatTime(v),p.payload.task]}/></PieChart></ResponsiveContainer></div>
              )}
            </div>
          </div>
          {life30.length>0&&(
            <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 font-mono">30-Day Life Task History</h3>
              <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={life30}><CartesianGrid strokeDasharray="3 3" stroke={th==='light'?'#e2e8f0':'#ffffff10'}/><XAxis dataKey="date" stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={9} interval={4}/><YAxis stroke={th==='light'?'#64748b':'#ffffff40'} fontSize={10} tickFormatter={v=>formatTime(v)}/><Tooltip contentStyle={{backgroundColor:th==='light'?'#fff':'#1c1d21',borderColor:th==='light'?'#e2e8f0':'#ffffff10',color:th==='light'?'#0f172a':'#fff'}} formatter={(v:any)=>[formatTime(v),'Life Task Time']}/><Bar dataKey="total_seconds" fill="#06b6d4" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
            </div>
          )}
          <div className={`border rounded-2xl p-6 ${th==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
            <h3 className="text-sm font-bold uppercase tracking-widest mb-4 font-mono">Today's Life Task Log</h3>
            {lifeTimelineToday.length===0?<p className={`text-sm font-mono ${th==='light'?'text-slate-400':'text-white/20'}`}>No life tasks logged today yet.</p>:(
              <div className="space-y-2">{lifeTimelineToday.map((l,i)=>(
                <div key={l.id} className={`flex items-center gap-4 p-3 rounded-xl border group ${th==='light'?'bg-slate-50 border-slate-100':'bg-white/5 border-white/5'}`}>
                  <span className={`text-[10px] font-mono w-5 text-center ${th==='light'?'text-slate-400':'text-white/30'}`}>{i+1}</span>
                  <div className="w-2 h-8 rounded-full bg-cyan-500"/>
                  <div className="flex-1"><p className="text-sm font-medium">{l.task_name}</p><p className={`text-[10px] font-mono ${th==='light'?'text-slate-400':'text-white/30'}`}>life · {new Date(l.logged_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</p></div>
                  <span className="font-mono font-bold text-sm text-cyan-500">{formatTime(l.duration_seconds)}</span>
                  <button onClick={()=>{ if(confirm(`Delete log entry for "${l.task_name}"?`)) onDeleteLog(l.id); }} className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all ${th==='light'?'hover:bg-red-100 text-slate-400 hover:text-red-500':'hover:bg-red-500/20 text-white/20 hover:text-red-400'}`} title="Delete this log entry"><XCircle className="w-4 h-4"/></button>
                </div>
              ))}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BenchmarksView ───────────────────────────────────────────────────────────
function BenchmarksView({benchmarks,theme,onDeleteBenchmark}:{benchmarks:Benchmark[];theme?:string;onDeleteBenchmark:(taskName:string)=>void}) {
  const sorted=[...benchmarks].sort((a,b)=>a.task_name.localeCompare(b.task_name));
  return(
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-purple-500"/>Performance Benchmarks</h2><span className={`text-[10px] font-mono uppercase tracking-widest ${theme==='light'?'text-slate-400':'text-white/30'}`}>{benchmarks.length} tasks tracked</span></div>
      {benchmarks.length===0?(
        <div className={`border rounded-2xl p-16 flex flex-col items-center justify-center ${theme==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}><History className={`w-12 h-12 mb-4 ${theme==='light'?'text-slate-300':'text-white/20'}`}/><p className={`font-mono text-sm ${theme==='light'?'text-slate-400':'text-white/20'}`}>No benchmarks yet. Start timing tasks to build your records.</p></div>
      ):(
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map(bm=>{const imp=bm.sessions>1?bm.last_seconds-bm.best_seconds:0;return(
            <div key={bm.task_name} className={`border rounded-2xl p-6 group ${theme==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`}>
              <div className="flex items-start justify-between mb-4">
                <h3 className="font-semibold text-sm">{bm.task_name}</h3>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full ${theme==='light'?'bg-slate-100 text-slate-400':'bg-white/10 text-white/30'}`}>{bm.sessions} sessions</span>
                  <button onClick={()=>{ if(confirm(`Delete benchmark record for "${bm.task_name}"? This cannot be undone.`)) onDeleteBenchmark(bm.task_name); }}
                    className={`opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all ${theme==='light'?'hover:bg-red-100 text-slate-400 hover:text-red-500':'hover:bg-red-500/20 text-white/20 hover:text-red-400'}`}
                    title="Delete benchmark record"><XCircle className="w-4 h-4"/></button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div><p className={`text-[10px] uppercase font-mono mb-1 ${theme==='light'?'text-slate-400':'text-white/30'}`}>Best</p><p className="text-2xl font-black font-mono text-emerald-500">{formatTime(bm.best_seconds)}</p></div>
                <div><p className={`text-[10px] uppercase font-mono mb-1 ${theme==='light'?'text-slate-400':'text-white/30'}`}>Last</p><p className={`text-2xl font-black font-mono ${bm.last_seconds<=bm.best_seconds?'text-emerald-500':'text-red-400'}`}>{formatTime(bm.last_seconds)}</p></div>
              </div>
              {bm.sessions>1&&<div className={`px-3 py-1.5 rounded-xl text-[11px] font-mono ${imp<=0?'bg-emerald-500/10 text-emerald-500':'bg-red-500/10 text-red-500'}`}>{imp<=0?'▼ Improved ':'▲ Slower '}{formatTime(Math.abs(imp))} vs best</div>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// ─── SettingsView ─────────────────────────────────────────────────────────────
function SettingsView({formData,setFormData,onSave,theme}:{formData:UserSettings;setFormData:(f:UserSettings)=>void;onSave:()=>void;theme?:string}) {
  const th2 = theme; // alias so YouTube section can reference it
  const card=`border rounded-2xl p-6 ${theme==='light'?'bg-white border-slate-200':'bg-[#1c1d21] border-white/5'}`;
  const inp=`w-full border rounded-xl py-3 px-4 text-sm focus:outline-none ${theme==='light'?'bg-slate-50 border-slate-200 focus:border-slate-400 text-slate-900':'bg-black/40 border-white/10 focus:border-white/30 text-white'}`;
  const lbl=`block text-[10px] uppercase tracking-wider font-mono mb-2 ${theme==='light'?'text-slate-400':'text-white/40'}`;

  return(
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-blue-500"/>Settings</h2>
      <div className={card}><h3 className={`text-xs font-bold uppercase tracking-widest mb-5 font-mono ${theme==='light'?'text-slate-500':'text-white/50'}`}>Profile</h3>
        <div className="space-y-4">
          <div><label className={lbl}>Your Name</label><input type="text" className={inp} value={formData.name} onChange={e=>setFormData({...formData,name:e.target.value})}/></div>
          <div><label className={lbl}>Exam Month</label><input type="month" className={inp} value={formData.exam_month} onChange={e=>setFormData({...formData,exam_month:e.target.value})}/></div>
          <div><label className={lbl}>Number of Subjects</label><input type="number" min="1" className={inp} value={formData.subject_count} onChange={e=>setFormData({...formData,subject_count:parseInt(e.target.value)||1})}/></div>
        </div>
      </div>
      <div className={card}><h3 className={`text-xs font-bold uppercase tracking-widest mb-5 font-mono ${theme==='light'?'text-slate-500':'text-white/50'}`}>Motivation</h3>
        <div><label className={lbl}>Negative Motivation</label><textarea className={`${inp} h-24 resize-none`} value={formData.negative_motivation} onChange={e=>setFormData({...formData,negative_motivation:e.target.value})}/></div>
      </div>
      <div className={card}><h3 className={`text-xs font-bold uppercase tracking-widest mb-5 font-mono ${theme==='light'?'text-slate-500':'text-white/50'}`}>Alerts &amp; Beep</h3>
        <div>
          <label className={lbl}>Overtime Beep Count</label>
          <p className={`text-xs mb-3 ${theme==='light'?'text-slate-400':'text-white/40'}`}>How many beeps play when a task exceeds its standard time</p>
          <div className="flex gap-2 flex-wrap">
            {[1,2,3,5,7,10].map(n=>(
              <button key={n} onClick={()=>setFormData({...formData,beep_count_overtime:n})}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${formData.beep_count_overtime===n?'bg-red-600 border-red-600 text-white':theme==='light'?'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200':'bg-white/10 border-white/10 text-white/60 hover:bg-white/20'}`}>
                {n}×
              </button>
            ))}
            <input type="number" min="1" max="20" className={`w-20 border rounded-xl py-2 px-3 text-sm font-bold text-center focus:outline-none ${theme==='light'?'bg-slate-50 border-slate-200 text-slate-900':'bg-black/40 border-white/10 text-white'}`}
              value={formData.beep_count_overtime} onChange={e=>setFormData({...formData,beep_count_overtime:Math.max(1,parseInt(e.target.value)||1)})}/>
          </div>
        </div>
      </div>

      {/* ── YouTube Class Monitor ── */}
      <div className={`border rounded-2xl p-6 ${th2==='light'?'bg-white border-red-200':'bg-[#1c1d21] border-red-500/20'}`}>
        <h3 className={`text-xs font-bold uppercase tracking-widest mb-1 font-mono flex items-center gap-2 ${th2==='light'?'text-red-700':'text-red-400'}`}>
          <span className="text-base">▶</span> YouTube Class Monitor
        </h3>
        <p className={`text-xs mb-4 leading-relaxed ${th2==='light'?'text-slate-500':'text-white/40'}`}>
          Automatically checked every 15 minutes. When a new video is detected, you'll get a beep, desktop notification, and an in-app banner to start the task instantly.
        </p>
        <div className={`rounded-xl divide-y ${th2==='light'?'border border-slate-200 divide-slate-100':'border border-white/10 divide-white/5'}`}>
          <div className="flex items-center gap-4 p-4">
            <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center shrink-0"><span className="text-white font-black text-xs">Q</span></div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${th2==='light'?'text-slate-900':'text-white'}`}>LEARNING CAPSULES - HARSHAL AGRAWAL</p>
              <p className={`text-xs mt-0.5 ${th2==='light'?'text-slate-400':'text-white/40'}`}>Triggers → <span className="font-mono font-bold text-red-400">Quant YT class</span></p>
            </div>
            <span className={`text-[10px] font-mono px-2 py-1 rounded-full ${th2==='light'?'bg-emerald-100 text-emerald-700':'bg-emerald-500/20 text-emerald-400'}`}>Active</span>
          </div>
          <div className="flex items-center gap-4 p-4">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shrink-0"><span className="text-white font-black text-xs">R</span></div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${th2==='light'?'text-slate-900':'text-white'}`}>Studyniti - Study with Smriti</p>
              <p className={`text-xs mt-0.5 ${th2==='light'?'text-slate-400':'text-white/40'}`}>Triggers → <span className="font-mono font-bold text-blue-400">Reasoning YT class</span></p>
            </div>
            <span className={`text-[10px] font-mono px-2 py-1 rounded-full ${th2==='light'?'bg-emerald-100 text-emerald-700':'bg-emerald-500/20 text-emerald-400'}`}>Active</span>
          </div>
        </div>
      </div>

      {/* ── Data Export / Import ── */}
      <div className={`border rounded-2xl p-6 ${th2==='light'?'bg-white border-emerald-200':'bg-[#1c1d21] border-emerald-500/20'}`}>
        <h3 className={`text-xs font-bold uppercase tracking-widest mb-1 font-mono flex items-center gap-2 ${th2==='light'?'text-emerald-700':'text-emerald-400'}`}>
          💾 Data Backup &amp; Restore
        </h3>
        <p className={`text-xs mb-4 leading-relaxed ${th2==='light'?'text-slate-500':'text-white/40'}`}>
          All your data lives in this browser. Export a backup file anytime — then import it on any device or after clearing your cache to restore everything instantly.
        </p>
        <div className="flex gap-3">
          <button onClick={() => {
            const payload: Record<string,any> = {};
            Object.values(KEYS).forEach(k => {
              const v = localStorage.getItem(k);
              if (v) payload[k] = JSON.parse(v);
            });
            // Also save all daily seed keys
            Object.keys(localStorage).filter(k => k.startsWith('examrigor_seeded_')).forEach(k => {
              payload[k] = true;
            });
            payload['_exportedAt'] = new Date().toISOString();
            payload['_version'] = '1.0';
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `examrigor-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }} className="flex-1 py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center justify-center gap-2">
            ⬇ Export All Data
          </button>
          <label className="flex-1 py-3 rounded-xl text-sm font-bold cursor-pointer flex items-center justify-center gap-2 border-2 border-dashed border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-all">
            ⬆ Import Backup
            <input type="file" accept=".json" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const data = JSON.parse(ev.target?.result as string);
                  let count = 0;
                  Object.entries(data).forEach(([k, v]) => {
                    if (k.startsWith('_')) return; // skip meta keys
                    localStorage.setItem(k, JSON.stringify(v));
                    count++;
                  });
                  alert(`✅ Restored ${count} data keys successfully! Refreshing app...`);
                  window.location.reload();
                } catch {
                  alert('❌ Invalid backup file. Please use a file exported from ExamRigor.');
                }
              };
              reader.readAsText(file);
              e.target.value = '';
            }}/>
          </label>
        </div>
      </div>

      <button onClick={onSave} className="w-full bg-red-600 text-white font-bold py-4 rounded-2xl hover:bg-red-500 flex items-center justify-center gap-2"><CheckCircle2 className="w-5 h-5"/>Save Settings</button>
    </div>
  );
}

// ─── LibraryManagerModal ──────────────────────────────────────────────────────
function LibraryManagerModal({theme,onClose}:{theme?:string;onClose:()=>void}) {
  const [tasks,setTasks]=useState<Task[]>(()=>getLibrary());
  const [editing,setEditing]=useState<Task|null>(null);
  const [adding,setAdding]=useState(false);
  const [newT,setNewT]=useState({name:'',category:'core' as 'core'|'life',type:'normal' as 'standard'|'normal',standard_minutes:30});
  const bg=theme==='light'?'bg-white border-slate-200 text-slate-900':'bg-[#1c1d21] border-white/10 text-white';
  const row=theme==='light'?'bg-slate-50 border-slate-100':'bg-white/5 border-white/5';
  const inp=`w-full border rounded-lg py-2 px-3 text-sm focus:outline-none transition-colors ${theme==='light'?'bg-white border-slate-300 text-slate-900 focus:border-slate-500':'bg-black/40 border-white/15 text-white focus:border-white/40'}`;
  const save=(t:Task[])=>{ LS.set(KEYS.library,t); setTasks([...t]); };
  const deleteTask=(id:number)=>{ if(id>=1001&&id<=1009){alert('Default tasks cannot be deleted.');return;} save(tasks.filter(t=>t.id!==id)); };
  const saveEdit=()=>{ if(!editing?.name.trim())return; save(tasks.map(t=>t.id===editing!.id?editing!:t)); setEditing(null); };
  const saveNew=()=>{
    if(!newT.name.trim())return;
    save([...tasks,{id:Date.now(),name:newT.name.trim(),category:newT.category,type:newT.type,standard_minutes:newT.type==='standard'?newT.standard_minutes:undefined}]);
    setNewT({name:'',category:'core',type:'normal',standard_minutes:30}); setAdding(false);
  };
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
      <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} className={`relative border rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col ${bg}`}>
        <div className={`flex items-center justify-between p-6 border-b ${theme==='light'?'border-slate-200':'border-white/10'}`}>
          <div><h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-blue-500"/>Manage Saved Tasks</h2><p className={`text-xs mt-0.5 font-mono ${theme==='light'?'text-slate-400':'text-white/30'}`}>Tasks saved here appear in the dropdown when adding to today</p></div>
          <button onClick={onClose} className={`p-2 rounded-lg ${theme==='light'?'hover:bg-slate-100':'hover:bg-white/10'}`}><XCircle className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {tasks.map(task=>(
            <div key={task.id} className={`rounded-xl border p-3 ${row}`}>
              {editing?.id===task.id?(
                <div className="space-y-2">
                  <input className={inp} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/>
                  <div className="flex gap-2">
                    <select className={`flex-1 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} value={editing.type} onChange={e=>setEditing({...editing,type:e.target.value as any})}><option value="normal">Normal</option><option value="standard">Standard</option></select>
                    {editing.type==='standard'&&<input type="number" min="1" className={`w-20 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} value={editing.standard_minutes||30} onChange={e=>setEditing({...editing,standard_minutes:parseInt(e.target.value)||30})}/>}
                    <select className={`flex-1 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} value={editing.category} onChange={e=>setEditing({...editing,category:e.target.value as any})}><option value="core">Core Study</option><option value="life">Life Task</option></select>
                  </div>
                  <div className="flex gap-2"><button onClick={()=>setEditing(null)} className={`flex-1 text-xs py-1.5 rounded-lg ${theme==='light'?'bg-slate-100 text-slate-600':'bg-white/10 text-white/60'}`}>Cancel</button><button onClick={saveEdit} className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-600 text-white font-bold">Save</button></div>
                </div>
              ):(
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{task.name}</p><p className={`text-[10px] font-mono uppercase ${theme==='light'?'text-slate-400':'text-white/30'}`}>{task.category} · {task.type}{task.standard_minutes?` · ${task.standard_minutes}m`:''}{task.id>=1001&&task.id<=1009?' · default':''}</p></div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={()=>setEditing({...task})} className={`text-[10px] px-3 py-1.5 rounded-lg font-medium ${theme==='light'?'bg-slate-100 text-slate-600 hover:bg-slate-200':'bg-white/10 text-white/60 hover:bg-white/20'}`}>Edit</button>
                    <button onClick={()=>deleteTask(task.id)} className={`text-[10px] px-3 py-1.5 rounded-lg font-medium ${task.id>=1001&&task.id<=1009?'opacity-30 cursor-not-allowed':''} ${theme==='light'?'bg-red-50 text-red-500 hover:bg-red-100':'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {adding?(
            <div className={`rounded-xl border p-4 space-y-2 ${theme==='light'?'bg-blue-50 border-blue-200':'bg-blue-500/10 border-blue-500/20'}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${theme==='light'?'text-blue-700':'text-blue-300'}`}>New Task</p>
              <input autoFocus className={inp} placeholder="Task name..." value={newT.name} onChange={e=>setNewT({...newT,name:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')saveNew();}}/>
              <div className="flex gap-2">
                <select className={`flex-1 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} value={newT.category} onChange={e=>setNewT({...newT,category:e.target.value as any})}><option value="core">Core Study</option><option value="life">Life Task</option></select>
                <select className={`flex-1 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} value={newT.type} onChange={e=>setNewT({...newT,type:e.target.value as any})}><option value="normal">Normal</option><option value="standard">Standard</option></select>
                {newT.type==='standard'&&<input type="number" min="1" className={`w-20 border rounded-lg py-1.5 px-3 text-xs ${theme==='light'?'bg-white border-slate-300 text-slate-900':'bg-black/40 border-white/15 text-white'}`} placeholder="Min" value={newT.standard_minutes} onChange={e=>setNewT({...newT,standard_minutes:parseInt(e.target.value)||30})}/>}
              </div>
              <div className="flex gap-2"><button onClick={()=>setAdding(false)} className={`flex-1 text-xs py-1.5 rounded-lg ${theme==='light'?'bg-slate-100 text-slate-600':'bg-white/10 text-white/60'}`}>Cancel</button><button onClick={saveNew} disabled={!newT.name.trim()} className="flex-1 text-xs py-1.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-40">Save Task</button></div>
            </div>
          ):(
            <button onClick={()=>setAdding(true)} className={`w-full py-3 border-dashed border rounded-xl text-xs font-bold flex items-center justify-center gap-2 ${theme==='light'?'border-slate-300 text-slate-500 hover:bg-slate-50':'border-white/10 text-white/30 hover:bg-white/5'}`}><Plus className="w-4 h-4"/>Add Custom Task to Library</button>
          )}
        </div>
        <div className={`p-4 border-t ${theme==='light'?'border-slate-200':'border-white/10'}`}><button onClick={onClose} className={`w-full py-3 rounded-xl font-bold text-sm ${theme==='light'?'bg-slate-900 text-white hover:bg-slate-800':'bg-white text-black hover:bg-white/90'}`}>Done</button></div>
      </motion.div>
    </div>
  );
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
// Thin wrapper so App.tsx can reference <LoginScreen /> while the full UI
// lives in AuthScreen.tsx (keeps concerns separated and avoids duplication).
function LoginScreen() {
  return <AuthScreen />;
}

// ─── SampleTimerModal ─────────────────────────────────────────────────────────
function SampleTimerModal({theme,negMotivation,examMonth,onClose}:{theme?:string;negMotivation:string;examMonth:string;onClose:()=>void}) {
  const [mins,setMins]=useState(2);
  const [started,setStarted]=useState(false);
  const [startTs,setStartTs]=useState(0);
  const [elapsed,setElapsed]=useState(0);
  const [buzzed,setBuzzed]=useState(false);
  const [showBreach,setShowBreach]=useState(false);
  const [reason,setReason]=useState('');
  const ref=useRef<any>(null);
  const limitSec=mins*60;
  useEffect(()=>{
    if(!started)return;
    ref.current=setInterval(()=>{
      const e=Math.floor((Date.now()-startTs)/1000); setElapsed(e);
      if(e>=limitSec&&!buzzed){ setBuzzed(true); playBeep(); setTimeout(playBeep,1500); setTimeout(playBeep,3000); setShowBreach(true); }
    },1000);
    return ()=>clearInterval(ref.current);
  },[started,startTs,limitSec,buzzed]);
  const bg=theme==='light'?'bg-white border-slate-200 text-slate-900':'bg-[#1c1d21] border-white/10 text-white';
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
      <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} className={`relative border rounded-2xl p-6 w-full max-w-md shadow-2xl ${bg}`}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2"><FlaskConical className="w-5 h-5 text-violet-400"/><h2 className="font-bold text-lg">Sample Timer Test</h2></div>
          <div className="flex items-center gap-2"><span className={`text-[10px] font-mono px-2 py-1 rounded-full ${theme==='light'?'bg-violet-100 text-violet-600':'bg-violet-500/20 text-violet-300'}`}>NO DATA SAVED</span><button onClick={onClose} className={`p-1.5 rounded-lg ${theme==='light'?'hover:bg-slate-100':'hover:bg-white/10'}`}><XCircle className="w-4 h-4"/></button></div>
        </div>
        {!started&&(
          <div className="mb-5 space-y-2">
            <p className={`text-sm ${theme==='light'?'text-slate-600':'text-white/60'}`}>Set test duration (minutes):</p>
            <div className="flex gap-2 flex-wrap">
              {[1,2,3,5,10].map(m=>(<button key={m} onClick={()=>setMins(m)} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${mins===m?'bg-violet-600 text-white':theme==='light'?'bg-slate-100 text-slate-600 hover:bg-slate-200':'bg-white/10 text-white/60 hover:bg-white/20'}`}>{m}m</button>))}
              <input type="number" min="1" max="120" className={`w-20 border rounded-xl py-2 px-3 text-sm font-bold text-center ${theme==='light'?'bg-slate-50 border-slate-300 text-slate-900':'bg-black/40 border-white/20 text-white'}`} value={mins} onChange={e=>setMins(Math.max(1,parseInt(e.target.value)||1))}/>
            </div>
          </div>
        )}
        {started&&(
          <div className="mb-5 text-center">
            <div className={`text-5xl font-black font-mono mb-2 ${buzzed?'text-red-500 animate-pulse':theme==='light'?'text-slate-900':'text-white'}`}>{buzzed?`+${formatTime(elapsed-limitSec)}`:formatTime(Math.max(0,limitSec-elapsed))}</div>
            <p className={`text-xs font-mono ${theme==='light'?'text-slate-400':'text-white/40'}`}>{buzzed?'OVERTIME':'Remaining'}</p>
            <div className={`mt-3 h-2 rounded-full overflow-hidden ${theme==='light'?'bg-slate-100':'bg-white/10'}`}><div className={`h-full rounded-full transition-all duration-1000 ${buzzed?'bg-red-500':'bg-violet-500'}`} style={{width:`${Math.min(100,(elapsed/limitSec)*100)}%`}}/></div>
            <p className={`text-[10px] font-mono mt-1 ${theme==='light'?'text-slate-400':'text-white/30'}`}>Elapsed: {formatTime(elapsed)} / {formatTime(limitSec)}</p>
          </div>
        )}
        {showBreach&&(
          <div className={`rounded-xl border p-4 mb-4 space-y-3 ${theme==='light'?'bg-red-50 border-red-300':'bg-red-500/10 border-red-500/30'}`}>
            <div className="flex items-center gap-2 text-red-500"><AlertTriangle className="w-5 h-5"/><span className="font-bold text-sm uppercase">Rigor Breach — Test Mode</span></div>
            {examMonth&&(()=>{const d=Math.ceil((new Date(examMonth+'-01').getTime()-Date.now())/864e5);return d>0?<p className={`text-xs font-mono ${theme==='light'?'text-red-700':'text-red-300'}`}><strong>{d}</strong> days · <strong>{Math.floor(d/30)}</strong> months left</p>:null;})()}
            <p className={`text-xs italic font-serif ${theme==='light'?'text-red-700':'text-red-200'}`}>"{negMotivation}"</p>
            <textarea className={`w-full border rounded-lg py-2 px-3 text-xs h-16 resize-none focus:outline-none ${theme==='light'?'bg-white border-red-200 text-slate-900':'bg-black/40 border-white/10 text-white'}`} placeholder="(Sample) Why did you go overtime?" value={reason} onChange={e=>setReason(e.target.value)}/>
          </div>
        )}
        <div className="flex gap-3">
          {!started?<button onClick={()=>{setStartTs(Date.now());setStarted(true);setBuzzed(false);setShowBreach(false);setElapsed(0);setReason('');}} className="flex-1 bg-violet-600 text-white font-bold py-3 rounded-xl hover:bg-violet-500 flex items-center justify-center gap-2"><Play className="w-4 h-4 fill-current"/>Start Test</button>
            :<button onClick={()=>{clearInterval(ref.current);setStarted(false);setElapsed(0);setBuzzed(false);setShowBreach(false);setReason('');}} className={`flex-1 font-bold py-3 rounded-xl flex items-center justify-center gap-2 ${theme==='light'?'bg-slate-200 text-slate-700':'bg-white/10 text-white'}`}><Square className="w-4 h-4"/>Reset</button>}
          <button onClick={onClose} className={`px-5 py-3 rounded-xl text-sm font-medium ${theme==='light'?'bg-slate-100 text-slate-600':'bg-white/10 text-white/60'}`}>Close</button>
        </div>
        <p className={`text-center text-[10px] font-mono mt-3 ${theme==='light'?'text-slate-300':'text-white/20'}`}>✓ This timer saves nothing to localStorage</p>
      </motion.div>
    </div>
  );
}
