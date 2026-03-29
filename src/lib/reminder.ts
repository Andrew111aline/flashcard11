import { DB } from '../types';
import { getTranslation } from './i18n';

export const PERM = {
  NOT_SUPPORTED: 'not-supported',
  DEFAULT: 'default',
  GRANTED: 'granted',
  DENIED: 'denied'
} as const;

export type PermissionState = typeof PERM[keyof typeof PERM];

export function getNotifPermission(): PermissionState {
  if (!('Notification' in window)) return PERM.NOT_SUPPORTED;
  return Notification.permission as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return PERM.NOT_SUPPORTED;
  const result = await Notification.requestPermission();
  return result as PermissionState;
}

let reminderTimer: number | null = null;

// Helper to get due cards count (we'll pass the DB or a function to get it)
export function startReminderChecker(getDB: () => DB, saveDB: (db: DB) => void) {
  if (reminderTimer) clearInterval(reminderTimer);
  // Check every 30 seconds
  reminderTimer = window.setInterval(() => checkAndFireReminders(getDB, saveDB), 30000);
  checkAndFireReminders(getDB, saveDB); // Execute immediately once
}

export function stopReminderChecker() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function toHHMM(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function pruneLastFired(db: DB, saveDB: (db: DB) => void) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = toDateStr(cutoff);

  let changed = false;
  const newLastFired = { ...db.settings.reminder.lastFired };

  Object.keys(newLastFired).forEach(key => {
    const datePart = key.split('_')[1];
    if (datePart && datePart < cutoffStr) {
      delete newLastFired[key];
      changed = true;
    }
  });

  if (changed) {
    db.settings.reminder.lastFired = newLastFired;
    saveDB(db);
  }
}

function buildNotifIconDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="#0d9488"/>
    <rect x="14" y="20" width="36" height="26" rx="4" fill="none" stroke="white" stroke-width="2.5"/>
    <line x1="14" y1="28" x2="50" y2="28" stroke="white" stroke-width="2.5"/>
    <line x1="22" y1="36" x2="30" y2="36" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="40" x2="38" y2="40" stroke="white" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function checkAndFireReminders(getDB: () => DB, saveDB: (db: DB) => void) {
  const db = getDB();
  const r = db.settings.reminder;
  
  if (!r || !r.enabled || !r.times || !r.times.length) return;
  if (getNotifPermission() !== PERM.GRANTED) return;

  const now = new Date();
  const todayStr = toDateStr(now);
  const nowHHMM = toHHMM(now);

  let fired = false;

  r.times.forEach(time => {
    const firedKey = `${time}_${todayStr}`;
    
    if (nowHHMM === time && !r.lastFired[firedKey]) {
      fireNotification(time, db);
      r.lastFired[firedKey] = true;
      fired = true;
    }
  });

  if (fired) {
    saveDB(db);
    pruneLastFired(db, saveDB);
  }
}

function fireNotification(time: string, db: DB) {
  const now = new Date();
  const dueCount = db.cards.filter(c => new Date(c.dueAt) <= now).length;
  const lang = db.settings.lang || 'zh';

  const n = new Notification(getTranslation(lang, 'notif_title'), {
    body: dueCount > 0
      ? getTranslation(lang, 'notif_body_due', dueCount)
      : getTranslation(lang, 'notif_body_none'),
    icon: buildNotifIconDataUrl(),
    tag: `fsrs-reminder-${time}`,
    requireInteraction: false,
    silent: false
  });

  n.onclick = () => {
    window.focus();
    n.close();
    window.location.hash = dueCount > 0 ? '#review' : '#home';
  };

  setTimeout(() => n.close(), 5000);
}

export function sendTestNotification(lang: string = 'zh') {
  if (getNotifPermission() !== PERM.GRANTED) return;
  const n = new Notification(getTranslation(lang, 'notif_test_title'), {
    body: getTranslation(lang, 'notif_test_body'),
    icon: buildNotifIconDataUrl(),
    tag: 'fsrs-test',
  });
  setTimeout(() => n.close(), 3000);
}
