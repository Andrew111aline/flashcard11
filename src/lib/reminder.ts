import {
  DB,
  ReminderDebugLogEntry,
  ReminderDebugSource,
  ReminderEffectKey,
  ReminderEffects,
  ReminderSettings,
  SoundType,
  VibrationPattern,
} from '../types';
import { getTranslation } from './i18n';

export const PERM = {
  NOT_SUPPORTED: 'not-supported',
  DEFAULT: 'default',
  GRANTED: 'granted',
  DENIED: 'denied',
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

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

type SaveDB = (db: DB | ((prev: DB) => DB)) => void;
type ReminderCheckSource = ReminderDebugSource;

interface ReminderAlertResult {
  dueCount: number;
  requestedEffects: ReminderEffectKey[];
  deliveredEffects: ReminderEffectKey[];
}

interface ReminderCheckOptions {
  source?: ReminderCheckSource;
  logIfIdle?: boolean;
}

export interface ReminderRuntimeState {
  isRunning: boolean;
  lastCheckAt: number | null;
  lastCheckSource: ReminderCheckSource | null;
  lastHiddenAt: number | null;
  nextCheckAt: number | null;
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
const REMINDER_CHECK_INTERVAL_MS = 20_000;
const REMINDER_MATCH_WINDOW_MS = 2 * 60 * 1000;
const REMINDER_VISIBILITY_RECOVERY_MS = 60 * 1000;
const DEFAULT_BADGE_COLOR = '#01696f';
const MAX_REMINDER_DEBUG_LOGS = 12;

export const DEFAULT_REMINDER_EFFECTS: ReminderEffects = {
  systemNotif: true,
  inAppPopup: true,
  vibration: true,
  sound: false,
};

export const DEFAULT_VIBRATION_PATTERN: VibrationPattern = 'standard';
export const DEFAULT_SOUND_TYPE: SoundType = 'bell';

export const VIBRATION_PATTERNS: Record<VibrationPattern, number[]> = {
  gentle: [150],
  standard: [200, 100, 200],
  strong: [300, 100, 300, 100, 300],
  pulse: [100, 50, 100, 50, 100, 50, 100],
};

export const SOUND_TYPES: SoundType[] = ['bell', 'chime', 'ping'];

let reminderTimer: number | null = null;
let activeGetDB: (() => DB) | null = null;
let activeSaveDB: SaveDB | null = null;
let lastHiddenAt = Date.now();
let lastCheckAt: number | null = null;
let lastCheckSource: ReminderCheckSource | null = null;
let reminderLifecycleBound = false;
let popupRoot: HTMLDivElement | null = null;
let popupHideTimer: number | null = null;
let popupKeyBindingInstalled = false;

export function createDefaultReminderSettings(): ReminderSettings {
  return {
    enabled: false,
    times: [],
    lastFired: {},
    effects: { ...DEFAULT_REMINDER_EFFECTS },
    vibrationPattern: DEFAULT_VIBRATION_PATTERN,
    soundType: DEFAULT_SOUND_TYPE,
    debugLog: [],
  };
}

export function getReminderEffects(reminder?: Partial<ReminderSettings> | null): ReminderEffects {
  return {
    ...DEFAULT_REMINDER_EFFECTS,
    ...(reminder?.effects ?? {}),
  };
}

export function hasReminderEffectsEnabled(reminder?: Partial<ReminderSettings> | null): boolean {
  return Object.values(getReminderEffects(reminder)).some(Boolean);
}

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

export function startReminderChecker(getDB: () => DB, saveDB: SaveDB) {
  activeGetDB = getDB;
  activeSaveDB = saveDB;
  bindReminderLifecycleListeners();

  if (reminderTimer !== null) return;

  reminderTimer = window.setInterval(() => runReminderCheck('interval'), REMINDER_CHECK_INTERVAL_MS);
  runReminderCheck('startup');
}

export function stopReminderChecker() {
  if (reminderTimer !== null) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }

  stopVibration();
}

export function getReminderRuntimeState(): ReminderRuntimeState {
  return {
    isRunning: reminderTimer !== null,
    lastCheckAt,
    lastCheckSource,
    lastHiddenAt,
    nextCheckAt:
      reminderTimer !== null && lastCheckAt !== null
        ? lastCheckAt + REMINDER_CHECK_INTERVAL_MS
        : null,
  };
}

export function runReminderDebugCheck(getDB: () => DB, saveDB: SaveDB) {
  return checkAndFireReminders(getDB, saveDB, {
    source: 'manual',
    logIfIdle: true,
  });
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatReminderDisplayTime(timeStr: string, lang: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (lang === 'en') {
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function supportsVibration() {
  return 'vibrate' in navigator;
}

export function fireVibration(pattern: VibrationPattern = DEFAULT_VIBRATION_PATTERN): boolean {
  if (!supportsVibration()) return false;

  try {
    return navigator.vibrate(VIBRATION_PATTERNS[pattern] || VIBRATION_PATTERNS.standard);
  } catch {
    return false;
  }
}

export function stopVibration() {
  if (!supportsVibration()) return;

  try {
    navigator.vibrate(0);
  } catch {
    // Ignore unsupported stop calls.
  }
}

export function testVibration(pattern: VibrationPattern = DEFAULT_VIBRATION_PATTERN): boolean {
  return fireVibration(pattern);
}

export function playReminderSound(soundType: SoundType = DEFAULT_SOUND_TYPE): boolean {
  const AudioCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioCtor) return false;

  try {
    const ctx = new AudioCtor();
    if (soundType === 'bell') {
      playBellSound(ctx);
    } else if (soundType === 'chime') {
      playChimeSound(ctx);
    } else {
      playPingSound(ctx);
    }

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 1800);
    return true;
  } catch {
    return false;
  }
}

export function fireReminderAlert(timeStr: string, db: DB): ReminderAlertResult {
  const reminder = db.settings.reminder;
  const effects = getReminderEffects(reminder);
  const dueCount = getDueCardCount(db);
  const lang = db.settings.lang || 'zh';
  const requestedEffects = (Object.entries(effects) as [ReminderEffectKey, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const deliveredEffects: ReminderEffectKey[] = [];

  if (effects.systemNotif && fireSystemNotification(timeStr, dueCount, lang)) {
    deliveredEffects.push('systemNotif');
  }

  if (effects.inAppPopup && showInAppReminderPopup(dueCount, timeStr, lang)) {
    deliveredEffects.push('inAppPopup');
  }

  if (effects.vibration && fireVibration(reminder.vibrationPattern || DEFAULT_VIBRATION_PATTERN)) {
    deliveredEffects.push('vibration');
  }

  if (effects.sound && playReminderSound(reminder.soundType || DEFAULT_SOUND_TYPE)) {
    deliveredEffects.push('sound');
  }

  return {
    dueCount,
    requestedEffects,
    deliveredEffects,
  };
}

export function sendTestReminder(db: DB, saveDB: SaveDB): boolean {
  if (!hasReminderEffectsEnabled(db.settings.reminder)) return false;
  const scheduledTime = db.settings.reminder.times[0] || formatHHMM(new Date());
  const result = fireReminderAlert(scheduledTime, db);

  appendReminderDebugLog(saveDB, {
    type: 'preview',
    source: 'manual',
    reason: 'manual-preview',
    scheduledTime,
    dueCount: result.dueCount,
    requestedEffects: result.requestedEffects,
    deliveredEffects: result.deliveredEffects,
  });

  return result.deliveredEffects.length > 0;
}

export function sendTestNotification(lang: string = 'zh') {
  return fireSystemNotification('test', 1, lang);
}

export function checkAndFireReminders(
  getDB: () => DB,
  saveDB: SaveDB,
  options: ReminderCheckOptions = {},
) {
  const source = options.source ?? 'interval';
  const db = getDB();
  const reminder = db.settings.reminder;
  const now = new Date();
  const nowMs = now.getTime();
  const previousCheckAt = lastCheckAt ?? nowMs - REMINDER_CHECK_INTERVAL_MS;

  lastCheckAt = nowMs;
  lastCheckSource = source;

  if (!reminder.enabled || !reminder.times.length || !hasReminderEffectsEnabled(reminder)) {
    if (options.logIfIdle) {
      appendReminderDebugLog(saveDB, {
        type: source === 'visibility' ? 'recovery' : 'check',
        source,
        reason: !reminder.enabled
          ? 'disabled'
          : !reminder.times.length
            ? 'no-times'
            : 'no-effects',
        scheduledTime: null,
        dueCount: null,
        requestedEffects: [],
        deliveredEffects: [],
      });
    }

    return false;
  }

  const todayKey = formatDateKey(now);
  const dueMatches = [...new Set(reminder.times.filter(Boolean))]
    .sort()
    .flatMap((timeStr) => {
      const firedKey = getReminderFiredKey(timeStr, todayKey);
      if (reminder.lastFired[firedKey]) return [];

      const target = getDateAtTime(now, timeStr);
      const targetMs = target.getTime();
      const diffMs = nowMs - targetMs;
      const withinWindow = diffMs >= 0 && diffMs < REMINDER_MATCH_WINDOW_MS;
      const missedSinceLastCheck = targetMs > previousCheckAt && targetMs <= nowMs;

      if (!withinWindow && !missedSinceLastCheck) {
        return [];
      }

      return [{
        timeStr,
        reason: missedSinceLastCheck ? 'missed-during-gap' : 'scheduled-window',
      }];
    });

  if (!dueMatches.length) {
    if (options.logIfIdle) {
      appendReminderDebugLog(saveDB, {
        type: source === 'visibility' ? 'recovery' : 'check',
        source,
        reason: source === 'visibility' ? 'recovery-no-due' : 'no-due',
        scheduledTime: null,
        dueCount: getDueCardCount(db),
        requestedEffects: [],
        deliveredEffects: [],
      });
    }

    return false;
  }

  const alertResults = dueMatches.map((match) => ({
    ...match,
    result: fireReminderAlert(match.timeStr, db),
  }));

  saveDB((prev) => {
    const nextLastFired = {
      ...(prev.settings.reminder?.lastFired ?? {}),
    };
    const nextDebugLog = [...(prev.settings.reminder?.debugLog ?? [])];

    alertResults.forEach(({ timeStr, reason, result }) => {
      nextLastFired[getReminderFiredKey(timeStr, todayKey)] = true;
      nextDebugLog.unshift(createReminderDebugLogEntry({
        type: source === 'visibility' ? 'recovery' : 'trigger',
        source,
        reason,
        scheduledTime: timeStr,
        dueCount: result.dueCount,
        requestedEffects: result.requestedEffects,
        deliveredEffects: result.deliveredEffects,
      }));
    });

    return {
      ...prev,
      settings: {
        ...prev.settings,
        reminder: {
          ...createDefaultReminderSettings(),
          ...prev.settings.reminder,
          times: [...(prev.settings.reminder?.times ?? [])],
          effects: getReminderEffects(prev.settings.reminder),
          vibrationPattern:
            prev.settings.reminder?.vibrationPattern || DEFAULT_VIBRATION_PATTERN,
          soundType: prev.settings.reminder?.soundType || DEFAULT_SOUND_TYPE,
          debugLog: nextDebugLog.slice(0, MAX_REMINDER_DEBUG_LOGS),
          lastFired: pruneLastFiredEntries(nextLastFired, now),
        },
      },
    };
  });

  return true;
}

function runReminderCheck(source: ReminderCheckSource = 'interval') {
  if (!activeGetDB || !activeSaveDB) return;
  checkAndFireReminders(activeGetDB, activeSaveDB, { source });
}

function bindReminderLifecycleListeners() {
  if (reminderLifecycleBound) return;

  document.addEventListener('visibilitychange', handleReminderVisibilityChange);
  window.addEventListener('focus', handleReminderFocus);
  reminderLifecycleBound = true;
}

function handleReminderVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const hiddenMs = Date.now() - lastHiddenAt;
    if (hiddenMs > REMINDER_VISIBILITY_RECOVERY_MS) {
      runReminderCheck('visibility');
    }
  } else {
    lastHiddenAt = Date.now();
  }
}

function handleReminderFocus() {
  if (document.visibilityState === 'visible') {
    runReminderCheck('focus');
  }
}

function getReminderFiredKey(timeStr: string, dateKey: string) {
  return `${timeStr}_${dateKey}`;
}

function formatHHMM(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getDateAtTime(reference: Date, timeStr: string) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const target = new Date(reference);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

function pruneLastFiredEntries(lastFired: Record<string, boolean>, reference: Date) {
  const cutoff = new Date(reference);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffKey = formatDateKey(cutoff);

  return Object.fromEntries(
    Object.entries(lastFired).filter(([key]) => {
      const datePart = key.split('_')[1];
      return !datePart || datePart >= cutoffKey;
    }),
  );
}

function appendReminderDebugLog(
  saveDB: SaveDB,
  entry: Omit<ReminderDebugLogEntry, 'id' | 'createdAt'>,
) {
  saveDB((prev) => {
    const reminder = prev.settings.reminder ?? createDefaultReminderSettings();
    return {
      ...prev,
      settings: {
        ...prev.settings,
        reminder: {
          ...createDefaultReminderSettings(),
          ...reminder,
          times: [...(reminder.times ?? [])],
          lastFired: { ...(reminder.lastFired ?? {}) },
          effects: getReminderEffects(reminder),
          vibrationPattern: reminder.vibrationPattern || DEFAULT_VIBRATION_PATTERN,
          soundType: reminder.soundType || DEFAULT_SOUND_TYPE,
          debugLog: [
            createReminderDebugLogEntry(entry),
            ...(reminder.debugLog ?? []),
          ].slice(0, MAX_REMINDER_DEBUG_LOGS),
        },
      },
    };
  });
}

function createReminderDebugLogEntry(
  entry: Omit<ReminderDebugLogEntry, 'id' | 'createdAt'>,
): ReminderDebugLogEntry {
  const createdAt = new Date().toISOString();
  return {
    id: `reminder-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    ...entry,
    requestedEffects: [...entry.requestedEffects],
    deliveredEffects: [...entry.deliveredEffects],
  };
}

function getDueCardCount(db: DB) {
  const nowMs = Date.now();
  return db.cards.filter((card) => new Date(card.dueAt).getTime() <= nowMs).length;
}

function fireSystemNotification(timeStr: string, dueCount: number, lang: string): boolean {
  if (getNotifPermission() !== PERM.GRANTED) return false;

  try {
    const options: NotificationOptions & { vibrate?: number[] } = {
      body: buildNotifBody(lang, dueCount),
      icon: buildNotifIconDataUrl(),
      badge: buildNotifBadgeDataUrl(),
      tag: `fsrs-reminder-${timeStr}`,
      requireInteraction: dueCount > 0,
      silent: false,
      vibrate: [200, 100, 200],
    };
    const notification = new Notification(getTranslation(lang, 'notif_title'), options);

    notification.onclick = () => {
      window.focus();
      notification.close();
      window.location.hash = dueCount > 0 ? '#review' : '#home';
    };

    if (dueCount === 0) {
      window.setTimeout(() => notification.close(), 5000);
    }

    return true;
  } catch {
    return false;
  }
}

function showInAppReminderPopup(dueCount: number, timeStr: string, lang: string): boolean {
  const root = ensurePopupContainer();
  const targetHash = dueCount > 0 ? '#review' : '#home';
  const primaryLabel =
    dueCount > 0
      ? getTranslation(lang, 'settings_reminder_popup_start_review', dueCount)
      : getTranslation(lang, 'settings_reminder_popup_view_today');

  root.hidden = false;
  root.innerHTML = `
    <div class="reminder-popup-backdrop" data-action="close"></div>
    <div class="reminder-popup-card" role="document" aria-labelledby="reminder-popup-title">
      <button type="button" class="reminder-popup-close" data-action="close" aria-label="${getTranslation(lang, 'btn_close')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <div class="reminder-popup-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#d9f5f1"/>
          <path d="M13 15.5A2.5 2.5 0 0 1 15.5 13h9A2.5 2.5 0 0 1 27 15.5v9A2.5 2.5 0 0 1 24.5 27h-9A2.5 2.5 0 0 1 13 24.5v-9Z" fill="#0d9488" opacity="0.16"/>
          <path d="M20 12.5v4M15 18h10M15 22h7" stroke="#0d9488" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="reminder-popup-content">
        <h3 id="reminder-popup-title" class="reminder-popup-title">${getTranslation(lang, 'settings_reminder_popup_title')}</h3>
        <p class="reminder-popup-body">${buildNotifBody(lang, dueCount)}</p>
        <p class="reminder-popup-time">${getTranslation(lang, 'settings_reminder_popup_scheduled')}: ${formatReminderDisplayTime(timeStr, lang)}</p>
      </div>
      <div class="reminder-popup-actions">
        <button type="button" class="reminder-popup-action reminder-popup-action-secondary" data-action="close">
          ${getTranslation(lang, 'settings_reminder_popup_later')}
        </button>
        <button type="button" class="reminder-popup-action reminder-popup-action-primary" data-action="primary">
          ${primaryLabel}
        </button>
      </div>
    </div>
  `;

  if (popupHideTimer !== null) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }

  root.querySelectorAll<HTMLElement>('[data-action="close"]').forEach((element) => {
    element.addEventListener('click', closeInAppPopup);
  });

  root.querySelector<HTMLElement>('[data-action="primary"]')?.addEventListener('click', () => {
    closeInAppPopup();
    window.location.hash = targetHash;
  });

  window.requestAnimationFrame(() => {
    root.querySelector('.reminder-popup-card')?.classList.add('reminder-popup-card--visible');
  });

  window.setTimeout(() => {
    root.querySelector<HTMLElement>('[data-action="primary"]')?.focus();
  }, 100);

  return true;
}

function closeInAppPopup() {
  if (!popupRoot || popupRoot.hidden) return;

  const card = popupRoot.querySelector('.reminder-popup-card');
  card?.classList.remove('reminder-popup-card--visible');
  card?.classList.add('reminder-popup-card--exit');
  stopVibration();

  if (popupHideTimer !== null) {
    clearTimeout(popupHideTimer);
  }

  popupHideTimer = window.setTimeout(() => {
    if (popupRoot) popupRoot.hidden = true;
  }, 280);
}

function ensurePopupContainer() {
  if (popupRoot && document.body.contains(popupRoot)) {
    return popupRoot;
  }

  popupRoot = document.createElement('div');
  popupRoot.id = 'reminder-popup';
  popupRoot.setAttribute('role', 'alertdialog');
  popupRoot.setAttribute('aria-modal', 'true');
  popupRoot.hidden = true;
  document.body.appendChild(popupRoot);

  if (!popupKeyBindingInstalled) {
    document.addEventListener('keydown', handlePopupKeydown);
    popupKeyBindingInstalled = true;
  }

  return popupRoot;
}

function handlePopupKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeInAppPopup();
  }
}

function buildNotifBody(lang: string, dueCount: number) {
  return dueCount > 0
    ? getTranslation(lang, 'notif_body_due', dueCount)
    : getTranslation(lang, 'notif_body_none');
}

function buildNotifIconDataUrl() {
  return buildSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="${DEFAULT_BADGE_COLOR}"/>
      <rect x="12" y="18" width="40" height="28" rx="5" fill="none" stroke="white" stroke-width="2.5"/>
      <line x1="12" y1="28" x2="52" y2="28" stroke="white" stroke-width="2.5"/>
      <rect x="20" y="34" width="10" height="3" rx="1.5" fill="white"/>
      <rect x="20" y="39" width="16" height="3" rx="1.5" fill="white"/>
    </svg>
  `);
}

function buildNotifBadgeDataUrl() {
  return buildSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="40" fill="white"/>
      <rect x="27" y="28" width="42" height="30" rx="6" fill="none" stroke="${DEFAULT_BADGE_COLOR}" stroke-width="6"/>
      <line x1="27" y1="40" x2="69" y2="40" stroke="${DEFAULT_BADGE_COLOR}" stroke-width="6"/>
      <rect x="37" y="50" width="11" height="5" rx="2.5" fill="${DEFAULT_BADGE_COLOR}"/>
      <rect x="37" y="58" width="18" height="5" rx="2.5" fill="${DEFAULT_BADGE_COLOR}"/>
    </svg>
  `);
}

function buildSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function playBellSound(ctx: AudioContext) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);

  gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 1.5);
}

function playChimeSound(ctx: AudioContext) {
  [523.25, 659.25].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0, ctx.currentTime + index * 0.2);
    gainNode.gain.linearRampToValueAtTime(0.35, ctx.currentTime + index * 0.2 + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.2 + 1);

    oscillator.start(ctx.currentTime + index * 0.2);
    oscillator.stop(ctx.currentTime + index * 0.2 + 1);
  });
}

function playPingSound(ctx: AudioContext) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.type = 'triangle';
  oscillator.frequency.value = 1046.5;
  gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.8);
}
