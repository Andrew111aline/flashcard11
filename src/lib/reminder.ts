import { DB } from '../types';
import { getTranslation } from './i18n';

export const PERM = {
  NOT_SUPPORTED: 'not-supported',
  DEFAULT: 'default',
  GRANTED: 'granted',
  DENIED: 'denied'
} as const;

export type PermissionState = typeof PERM[keyof typeof PERM];
export type NotificationSupport = 'supported' | 'needs-pwa' | 'none';
export type PermissionGuideState =
  | PermissionState
  | 'ios-wrong-browser'
  | 'ios-too-old'
  | 'needs-pwa';

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export interface PlatformInfo {
  isWindows: boolean;
  isMac: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isIPad: boolean;
  isSafari: boolean;
  isChrome: boolean;
  isFirefox: boolean;
  isEdge: boolean;
  isSamsungBrowser: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isStandalone: boolean;
  isIOSWebPushCapable: boolean;
  notifSupport: NotificationSupport;
}

export interface PermissionStatus {
  state: PermissionGuideState;
  canEnable: boolean;
  support: NotificationSupport;
  platform: PlatformInfo;
  permission: PermissionState;
}

const IOS_ALT_BROWSER_PATTERN = /Chrome|CriOS|FxiOS|Firefox|Edg\/|EdgiOS|OPR|OPiOS|SamsungBrowser/i;

export function getPlatformInfo(): PlatformInfo {
  const ua = navigator.userAgent || '';
  const nav = navigator as NavigatorWithStandalone;
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIOS;
  const isMobile = isAndroid || isIOS;
  const isTablet = isIPad || (isAndroid && !/Mobile/i.test(ua));
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;

  let isIOSWebPushCapable = false;
  if (isIOS) {
    const match = ua.match(/OS (\d+)_(\d+)/i);
    if (match) {
      const major = Number.parseInt(match[1], 10);
      const minor = Number.parseInt(match[2], 10);
      isIOSWebPushCapable = major > 16 || (major === 16 && minor >= 4);
    }
  }

  const isSafari = /Safari/i.test(ua) && !IOS_ALT_BROWSER_PATTERN.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isEdge = /Edg\//i.test(ua) || /EdgiOS/i.test(ua);
  const isSamsungBrowser = /SamsungBrowser/i.test(ua);

  let notifSupport: NotificationSupport = 'supported';
  if (!('Notification' in window)) {
    notifSupport = 'none';
  } else if (isIOS && !isSafari) {
    notifSupport = 'none';
  } else if (isIOS && !isIOSWebPushCapable) {
    notifSupport = 'none';
  } else if (isIOS && isIOSWebPushCapable && !isStandalone) {
    notifSupport = 'needs-pwa';
  }

  return {
    isWindows: /Windows/i.test(ua),
    isMac,
    isAndroid,
    isIOS,
    isIPad,
    isSafari,
    isChrome,
    isFirefox,
    isEdge,
    isSamsungBrowser,
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    isStandalone,
    isIOSWebPushCapable,
    notifSupport,
  };
}

export function getPermissionStatus(): PermissionStatus {
  const platform = getPlatformInfo();
  const support = platform.notifSupport;

  if (support === 'none') {
    if (platform.isIOS && !platform.isSafari) {
      return {
        state: 'ios-wrong-browser',
        canEnable: false,
        support,
        platform,
        permission: PERM.NOT_SUPPORTED,
      };
    }

    if (platform.isIOS && !platform.isIOSWebPushCapable) {
      return {
        state: 'ios-too-old',
        canEnable: false,
        support,
        platform,
        permission: PERM.NOT_SUPPORTED,
      };
    }

    return {
      state: PERM.NOT_SUPPORTED,
      canEnable: false,
      support,
      platform,
      permission: PERM.NOT_SUPPORTED,
    };
  }

  if (support === 'needs-pwa') {
    return {
      state: 'needs-pwa',
      canEnable: false,
      support,
      platform,
      permission: PERM.NOT_SUPPORTED,
    };
  }

  const permission = Notification.permission as PermissionState;
  return {
    state: permission,
    canEnable: permission !== PERM.DENIED,
    support,
    platform,
    permission,
  };
}

export function getNotifPermission(): PermissionState {
  const status = getPermissionStatus();
  return status.support === 'supported' ? status.permission : PERM.NOT_SUPPORTED;
}

export async function requestPermission(): Promise<PermissionState> {
  const status = getPermissionStatus();
  if (status.support !== 'supported' || !('Notification' in window)) {
    return PERM.NOT_SUPPORTED;
  }

  try {
    const result = await Notification.requestPermission();
    return result as PermissionState;
  } catch {
    return getNotifPermission();
  }
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
