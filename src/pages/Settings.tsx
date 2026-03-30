import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Globe,
  Info,
  Plus,
  Save,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useDB, useTranslation } from '../lib/db';
import { cn } from '../lib/utils';
import { ReminderSettings } from '../types';
import {
  getPermissionStatus,
  PERM,
  PermissionStatus,
  requestPermission,
  sendTestNotification,
} from '../lib/reminder';

const MAX_REMINDER_TIMES = 5;
const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  times: [],
  lastFired: {},
};

type GuideTone = 'success' | 'danger' | 'info' | 'warning' | 'neutral';

function cloneReminder(reminder?: ReminderSettings): ReminderSettings {
  return {
    enabled: reminder?.enabled ?? DEFAULT_REMINDER.enabled,
    times: [...(reminder?.times ?? DEFAULT_REMINDER.times)],
    lastFired: { ...(reminder?.lastFired ?? DEFAULT_REMINDER.lastFired) },
  };
}

function normalizeReminder(reminder: ReminderSettings): ReminderSettings {
  return {
    enabled: reminder.enabled,
    times: [...new Set(reminder.times.filter(Boolean))].sort(),
    lastFired: { ...reminder.lastFired },
  };
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Copy failed');
  }
}

export function Settings() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const [retention, setRetention] = useState(db.settings.retention * 100);
  const [maxInterval, setMaxInterval] = useState(db.settings.maxInterval);
  const [dailyNewCards, setDailyNewCards] = useState(db.settings.dailyNewCards);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(() => getPermissionStatus());
  const timeInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const reminder = cloneReminder(db.settings.reminder);
  const reminderEnabled = reminder.enabled;
  const reminderTimes = reminder.times;
  const isGranted = permissionStatus.state === PERM.GRANTED;
  const isMobileDevice = permissionStatus.platform.isMobile || permissionStatus.platform.isTablet;

  useEffect(() => {
    setRetention(db.settings.retention * 100);
    setMaxInterval(db.settings.maxInterval);
    setDailyNewCards(db.settings.dailyNewCards);
  }, [db.settings.retention, db.settings.maxInterval, db.settings.dailyNewCards]);

  useEffect(() => {
    const refreshPermission = () => setPermissionStatus(getPermissionStatus());
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPermission();
    };

    refreshPermission();
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const media = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => refreshPermission();
    if (media.addEventListener) media.addEventListener('change', handleDisplayModeChange);
    else media.addListener(handleDisplayModeChange);

    return () => {
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (media.removeEventListener) media.removeEventListener('change', handleDisplayModeChange);
      else media.removeListener(handleDisplayModeChange);
    };
  }, []);

  const updateReminderSettings = (updater: (current: ReminderSettings) => ReminderSettings) => {
    setDB((prev) => {
      const current = cloneReminder(prev.settings.reminder);
      return {
        ...prev,
        settings: {
          ...prev.settings,
          reminder: normalizeReminder(updater(current)),
        },
      };
    });
  };

  const handleSave = () => {
    setDB((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        retention: retention / 100,
        maxInterval,
        dailyNewCards,
      },
    }));

    alert(t('settings_saved'));
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fsrs-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.decks && data.settings && (data.cards || data.notes)) {
          if (confirm(t('settings_import_confirm'))) {
            setDB(data);
            alert(t('settings_import_success'));
          }
        } else {
          alert(t('settings_import_invalid'));
        }
      } catch {
        alert(t('settings_import_fail'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClear = () => {
    if (confirm(t('settings_clear_confirm'))) {
      if (confirm(t('settings_clear_confirm2'))) {
        setDB({
          decks: [],
          notes: [],
          cards: [],
          reviews: [],
          settings: {
            lang: db.settings.lang,
            retention: 0.9,
            maxInterval: 36500,
            dailyNewCards: 20,
            reminder: cloneReminder(DEFAULT_REMINDER),
          },
        });
        alert(t('settings_clear_success'));
      }
    }
  };

  const handleRequestPermission = async () => {
    await requestPermission();
    setPermissionStatus(getPermissionStatus());
  };

  const handleToggleReminder = (enabled: boolean) => {
    if (!isGranted) return;
    updateReminderSettings((current) => ({ ...current, enabled }));
  };

  const handleAddReminderTime = () => {
    if (reminderTimes.length >= MAX_REMINDER_TIMES) return;

    const existing = new Set(reminderTimes);
    const candidates = ['09:00', '12:00', '18:00', '20:00', '22:00'];
    const defaultTime = candidates.find((time) => !existing.has(time)) || '09:00';

    updateReminderSettings((current) => ({
      ...current,
      times: [...current.times, defaultTime],
    }));
  };

  const handleRemoveReminderTime = (index: number) => {
    updateReminderSettings((current) => ({
      ...current,
      times: current.times.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const handleUpdateReminderTime = (index: number, value: string) => {
    if (!value) return;
    if (reminderTimes.includes(value) && reminderTimes.indexOf(value) !== index) {
      alert(t('settings_reminder_exists'));
      return;
    }

    updateReminderSettings((current) => ({
      ...current,
      times: current.times.map((time, currentIndex) => (currentIndex === index ? value : time)),
    }));
  };

  const openTimePicker = (index: number) => {
    const input = timeInputRefs.current[index];
    if (!input) return;

    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker();
        return;
      } catch {
        // Fall through to focus + click.
      }
    }

    input.focus();
    input.click();
  };

  const handleCopyLink = async () => {
    try {
      await copyTextToClipboard(window.location.href);
      alert(t('settings_reminder_copy_success'));
    } catch {
      alert(t('settings_reminder_copy_fail'));
    }
  };

  const handleCheckPWAInstalled = () => {
    const nextStatus = getPermissionStatus();
    setPermissionStatus(nextStatus);
    if (nextStatus.state === 'needs-pwa') {
      alert(t('settings_reminder_add_home_open'));
    }
  };

  const getNextFireLabel = (timeStr: string) => {
    const now = new Date();
    const [h, m] = timeStr.split(':').map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const diffMs = next.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffMin = Math.floor((diffMs % 3600000) / 60000);

    if (diffH === 0 && diffMin <= 1) return t('soon');
    if (diffH === 0) return t('settings_reminder_in_min', diffMin);
    if (diffH < 24) return t('settings_reminder_in_hour', diffH);
    return t('settings_reminder_tomorrow');
  };

  const formatDisplayTime = (hhmm: string) => {
    const [hours, minutes] = hhmm.split(':').map(Number);
    if (db.settings.lang === 'en') {
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const getDeniedSteps = () => {
    const platform = permissionStatus.platform;

    if (platform.isWindows && (platform.isChrome || platform.isEdge)) {
      return [t('settings_reminder_restore_win_chrome')];
    }

    if (platform.isWindows && platform.isFirefox) {
      return [t('settings_reminder_restore_win_firefox')];
    }

    if (platform.isMac && (platform.isChrome || platform.isEdge)) {
      return [
        t('settings_reminder_restore_mac_chrome_browser'),
        t('settings_reminder_restore_mac_chrome_system'),
      ];
    }

    if (platform.isMac && platform.isSafari) {
      return [t('settings_reminder_restore_mac_safari')];
    }

    if (platform.isAndroid && platform.isChrome) {
      return [t('settings_reminder_restore_android_chrome')];
    }

    if (platform.isAndroid && platform.isSamsungBrowser) {
      return [t('settings_reminder_restore_android_samsung')];
    }

    if (platform.isIOS) {
      return [t('settings_reminder_restore_ios')];
    }

    return [t('settings_reminder_restore_generic')];
  };

  const switchLang = (lang: 'zh' | 'en') => {
    setDB((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        lang,
      },
    }));
  };

  const renderGuideCard = ({
    tone,
    icon,
    title,
    description,
    body,
    actions,
  }: {
    tone: GuideTone;
    icon: React.ReactNode;
    title: string;
    description?: string;
    body?: React.ReactNode;
    actions?: React.ReactNode;
  }) => {
    const toneClasses: Record<GuideTone, string> = {
      success: 'border-emerald-200 bg-emerald-50/80',
      danger: 'border-rose-200 bg-rose-50/90',
      info: 'border-sky-200 bg-sky-50/90',
      warning: 'border-amber-200 bg-amber-50/90',
      neutral: 'border-slate-200 bg-slate-50/90',
    };

    const iconClasses: Record<GuideTone, string> = {
      success: 'bg-emerald-100 text-emerald-700',
      danger: 'bg-rose-100 text-rose-700',
      info: 'bg-sky-100 text-sky-700',
      warning: 'bg-amber-100 text-amber-700',
      neutral: 'bg-slate-200 text-slate-700',
    };

    return (
      <div className={cn('border-b px-5 py-4', toneClasses[tone])}>
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconClasses[tone])}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
            {body ? <div className="mt-3">{body}</div> : null}
            {actions ? <div className="mt-4">{actions}</div> : null}
          </div>
        </div>
      </div>
    );
  };

  const renderPermissionGuide = () => {
    switch (permissionStatus.state) {
      case 'ios-wrong-browser':
        return renderGuideCard({
          tone: 'warning',
          icon: <CircleAlert className="h-5 w-5" />,
          title: t('settings_reminder_guide_browser_title'),
          description: t('settings_reminder_guide_browser_desc'),
          actions: (
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-900 transition hover:bg-amber-100 sm:w-auto"
            >
              <Copy className="h-4 w-4" />
              {t('settings_reminder_copy_link')}
            </button>
          ),
        });

      case 'ios-too-old':
        return renderGuideCard({
          tone: 'warning',
          icon: <Smartphone className="h-5 w-5" />,
          title: t('settings_reminder_guide_upgrade_title'),
          description: t('settings_reminder_guide_upgrade_desc'),
        });

      case 'needs-pwa':
        return renderGuideCard({
          tone: 'info',
          icon: <Smartphone className="h-5 w-5" />,
          title: t('settings_reminder_guide_pwa_title'),
          description: permissionStatus.platform.isIPad
            ? t('settings_reminder_guide_pwa_desc_pad')
            : t('settings_reminder_guide_pwa_desc_phone'),
          body: (
            <div className="rounded-[1.4rem] bg-white/80 p-4 ring-1 ring-sky-200/80">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800/70">
                {t('settings_reminder_add_home_subtitle')}
              </p>
              <div className="mt-4 space-y-3">
                {[1, 2, 3].map((step) => {
                  const labels = [
                    t('settings_reminder_add_home_step1'),
                    t('settings_reminder_add_home_step2'),
                    t('settings_reminder_add_home_step3'),
                  ];

                  return (
                    <div key={step} className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                        {step}
                      </div>
                      <p className="text-sm leading-6 text-slate-700">{labels[step - 1]}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-xs leading-6 text-slate-500">{t('settings_reminder_add_home_note')}</p>
            </div>
          ),
          actions: (
            <button
              type="button"
              onClick={handleCheckPWAInstalled}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-sky-300 bg-white px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-100 sm:w-auto"
            >
              {t('settings_reminder_add_home_check')}
            </button>
          ),
        });

      case PERM.DEFAULT:
        return renderGuideCard({
          tone: 'info',
          icon: <Bell className="h-5 w-5" />,
          title: t('settings_reminder_guide_default_title'),
          description: isMobileDevice
            ? t('settings_reminder_guide_default_desc_mobile')
            : t('settings_reminder_guide_default_desc_desktop'),
          actions: (
            <button
              type="button"
              onClick={handleRequestPermission}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-teal-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-teal-700 sm:w-auto"
            >
              {t('settings_reminder_enable')}
            </button>
          ),
        });

      case PERM.GRANTED:
        return renderGuideCard({
          tone: 'success',
          icon: <CheckCircle2 className="h-5 w-5" />,
          title: t('settings_reminder_guide_granted_title'),
        });

      case PERM.DENIED:
        return renderGuideCard({
          tone: 'danger',
          icon: <BellOff className="h-5 w-5" />,
          title: t('settings_reminder_guide_denied_title'),
          body: (
            <div className="rounded-[1.4rem] bg-white/80 p-4 ring-1 ring-rose-200/80">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-900/70">
                {t('settings_reminder_restore_title')}
              </p>
              <div className="mt-3 space-y-2">
                {getDeniedSteps().map((step) => (
                  <div key={step} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          ),
        });

      default:
        return renderGuideCard({
          tone: 'neutral',
          icon: <AlertTriangle className="h-5 w-5" />,
          title: t('settings_reminder_guide_not_supported_title'),
          description: t('settings_reminder_guide_not_supported_desc'),
        });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-8 text-3xl font-bold text-gray-900">{t('settings_title')}</h1>

      <div className="space-y-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-gray-900">
            <Globe className="h-5 w-5 text-teal-600" />
            {t('settings_lang')}
          </h2>

          <div className="flex gap-4">
            <button
              onClick={() => switchLang('zh')}
              className={`flex-1 rounded-lg border-2 px-4 py-3 transition-all ${
                db.settings.lang === 'zh'
                  ? 'border-teal-600 bg-teal-50 font-bold text-teal-700'
                  : 'border-gray-200 text-gray-600 hover:border-teal-200 hover:bg-gray-50'
              }`}
            >
              {t('settings_lang_zh')}
            </button>
            <button
              onClick={() => switchLang('en')}
              className={`flex-1 rounded-lg border-2 px-4 py-3 transition-all ${
                db.settings.lang === 'en'
                  ? 'border-teal-600 bg-teal-50 font-bold text-teal-700'
                  : 'border-gray-200 text-gray-600 hover:border-teal-200 hover:bg-gray-50'
              }`}
            >
              {t('settings_lang_en')}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 text-xl font-bold text-gray-900">{t('settings_fsrs')}</h2>

          <div className="space-y-6">
            <div>
              <div className="mb-2 flex justify-between">
                <label className="block text-sm font-medium text-gray-700">{t('settings_retention')}</label>
                <span className="text-sm font-bold text-teal-600">{retention}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="99"
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-teal-600"
              />
              <p className="mt-2 text-xs text-gray-500">{t('settings_retention_desc')}</p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings_max_interval')}</label>
                <input
                  type="number"
                  min="1"
                  value={maxInterval}
                  onChange={(e) => setMaxInterval(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings_new_cards')}</label>
                <input
                  type="number"
                  min="1"
                  value={dailyNewCards}
                  onChange={(e) => setDailyNewCards(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex justify-end border-t border-gray-100 pt-4">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-2 font-medium text-white transition-colors hover:bg-teal-700"
              >
                <Save className="h-4 w-4" />
                {t('common_save')}
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                <Bell className="h-5 w-5 text-teal-600" />
                {t('settings_reminder')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">{t('settings_reminder_desc')}</p>
            </div>

            <label
              className={cn(
                'relative inline-flex h-10 w-[3.75rem] shrink-0 items-center',
                isGranted ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              )}
              aria-label={t('settings_reminder_toggle_label')}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={reminderEnabled}
                onChange={(e) => handleToggleReminder(e.target.checked)}
                disabled={!isGranted}
              />
              <span className="h-8 w-14 rounded-full bg-slate-200 transition peer-checked:bg-teal-600 peer-disabled:bg-slate-200/80" />
              <span className="pointer-events-none absolute left-[3px] top-[5px] h-7 w-7 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-6" />
            </label>
          </div>

          {renderPermissionGuide()}

          {isGranted ? (
            <div className={cn('px-5 py-4 transition-opacity duration-200', !reminderEnabled && 'pointer-events-none opacity-50')}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-500">{t('settings_reminder_times')}</span>
                <button
                  type="button"
                  onClick={handleAddReminderTime}
                  disabled={reminderTimes.length >= MAX_REMINDER_TIMES}
                  title={reminderTimes.length >= MAX_REMINDER_TIMES ? t('settings_reminder_limit') : undefined}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('settings_reminder_add')}
                </button>
              </div>

              {reminderTimes.length === 0 ? (
                <div className="mt-4 rounded-[1.25rem] border border-dashed border-slate-300 px-4 py-7 text-center text-sm text-slate-500">
                  {t('settings_reminder_empty')}
                </div>
              ) : (
                <div className="mt-3">
                  {reminderTimes.map((time, index) => (
                    <div
                      key={`${time}-${index}`}
                      className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => openTimePicker(index)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openTimePicker(index);
                          }
                        }}
                        className="flex min-h-[44px] flex-1 items-center gap-3 rounded-[1.15rem] p-1 text-left transition hover:bg-slate-50"
                        aria-label={t('settings_reminder_update_aria', time)}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-teal-700">
                          <Clock3 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[1.35rem] font-semibold tracking-[0.02em] text-slate-900 tabular-nums sm:text-[1.5rem]">
                            {formatDisplayTime(time)}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">{getNextFireLabel(time)}</div>
                        </div>
                      </button>

                      <input
                        ref={(node) => {
                          timeInputRefs.current[index] = node;
                        }}
                        type="time"
                        value={time}
                        onChange={(e) => handleUpdateReminderTime(index, e.target.value)}
                        className="absolute h-0 w-0 opacity-0"
                        aria-hidden="true"
                        tabIndex={-1}
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveReminderTime(index)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label={t('settings_reminder_delete_aria', time)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {reminderTimes.length > 0 && reminderTimes.length < MAX_REMINDER_TIMES ? (
                <button
                  type="button"
                  onClick={handleAddReminderTime}
                  className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[1.1rem] border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-teal-700 transition hover:border-teal-300 hover:bg-teal-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('settings_reminder_add')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-slate-100 px-5 py-4">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-xs leading-6 text-slate-500">
                  <strong>{t('settings_reminder_important')}</strong> {t('settings_reminder_important_desc')}
                </p>
                {isGranted ? (
                  <button
                    type="button"
                    onClick={() => sendTestNotification(db.settings.lang)}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
                  >
                    {t('settings_reminder_test')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 text-xl font-bold text-gray-900">{t('settings_data')}</h2>

          <div className="space-y-4">
            <div className="flex flex-col items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:flex-row">
              <div>
                <h3 className="font-medium text-gray-900">{t('settings_export')}</h3>
                <p className="text-sm text-gray-500">{t('settings_export_desc')}</p>
              </div>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Download className="h-4 w-4" />
                {t('settings_export_btn')}
              </button>
            </div>

            <div className="flex flex-col items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:flex-row">
              <div>
                <h3 className="font-medium text-gray-900">{t('settings_import')}</h3>
                <p className="text-sm text-gray-500">{t('settings_import_desc')}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50">
                <Upload className="h-4 w-4" />
                {t('settings_import_btn')}
                <input type="file" accept=".json" onChange={handleImport} className="hidden" />
              </label>
            </div>

            <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-lg border border-red-100 bg-red-50 p-4 sm:flex-row">
              <div>
                <h3 className="flex items-center gap-2 font-medium text-red-900">
                  <AlertTriangle className="h-4 w-4" />
                  {t('settings_danger')}
                </h3>
                <p className="text-sm text-red-700">{t('settings_danger_desc')}</p>
              </div>
              <button
                onClick={handleClear}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" />
                {t('settings_clear')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
