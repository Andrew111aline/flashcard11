import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
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
  Volume2,
  X,
} from 'lucide-react';
import { useDB, useTranslation } from '../lib/db';
import { cn } from '../lib/utils';
import { ReminderSettings } from '../types';
import {
  createDefaultReminderSettings,
  formatReminderDisplayTime,
  getReminderRuntimeState,
  getPermissionStatus,
  getReminderEffects,
  PERM,
  PermissionStatus,
  playReminderSound,
  requestPermission,
  runReminderDebugCheck,
  sendTestReminder,
  SOUND_TYPES,
  supportsVibration,
  testVibration,
  VIBRATION_PATTERNS,
} from '../lib/reminder';

const MAX_REMINDER_TIMES = 5;

type GuideTone = 'success' | 'danger' | 'info' | 'warning' | 'neutral';

function cloneReminder(reminder?: ReminderSettings): ReminderSettings {
  const fallback = createDefaultReminderSettings();
  return {
    ...fallback,
    ...reminder,
    times: [...(reminder?.times ?? fallback.times)],
    lastFired: { ...(reminder?.lastFired ?? fallback.lastFired) },
    debugLog: [...(reminder?.debugLog ?? fallback.debugLog)],
    effects: getReminderEffects(reminder),
    vibrationPattern: reminder?.vibrationPattern ?? fallback.vibrationPattern,
    soundType: reminder?.soundType ?? fallback.soundType,
  };
}

function normalizeReminder(reminder: ReminderSettings): ReminderSettings {
  return {
    ...createDefaultReminderSettings(),
    ...reminder,
    times: [...new Set(reminder.times.filter(Boolean))].sort(),
    lastFired: { ...reminder.lastFired },
    debugLog: [...reminder.debugLog],
    effects: getReminderEffects(reminder),
    vibrationPattern: reminder.vibrationPattern,
    soundType: reminder.soundType,
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
  const [runtimeState, setRuntimeState] = useState(() => getReminderRuntimeState());
  const timeInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const reminder = cloneReminder(db.settings.reminder);
  const reminderTimes = reminder.times;
  const reminderEffects = reminder.effects;
  const notificationsGranted = permissionStatus.state === PERM.GRANTED;
  const systemNotificationsSupported = permissionStatus.support === 'supported';
  const vibrationSupported = supportsVibration();
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

  useEffect(() => {
    const refreshRuntime = () => setRuntimeState(getReminderRuntimeState());
    refreshRuntime();
    const intervalId = window.setInterval(refreshRuntime, 5000);
    window.addEventListener('focus', refreshRuntime);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', refreshRuntime);
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
            reminder: createDefaultReminderSettings(),
          },
        });
        alert(t('settings_clear_success'));
      }
    }
  };

  const handleRequestPermission = async () => {
    const result = await requestPermission();
    setPermissionStatus(getPermissionStatus());

    if (result === PERM.GRANTED) {
      updateReminderSettings((current) => ({
        ...current,
        enabled: true,
      }));
    }
  };

  const handleToggleReminder = (enabled: boolean) => {
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

  const handleUpdateEffect = (
    key: keyof ReminderSettings['effects'],
    value: boolean,
    options: { disabled?: boolean } = {},
  ) => {
    if (options.disabled) return;

    updateReminderSettings((current) => ({
      ...current,
      effects: {
        ...getReminderEffects(current),
        [key]: value,
      },
    }));
  };

  const handleSetVibrationPattern = (pattern: ReminderSettings['vibrationPattern']) => {
    updateReminderSettings((current) => ({
      ...current,
      vibrationPattern: pattern,
    }));

    if (!testVibration(pattern)) {
      alert(t('settings_reminder_vibration_not_supported'));
    }
  };

  const handleSetSoundType = (soundType: ReminderSettings['soundType']) => {
    updateReminderSettings((current) => ({
      ...current,
      soundType,
    }));
    playReminderSound(soundType);
    setRuntimeState(getReminderRuntimeState());
  };

  const handlePreviewReminder = () => {
    if (!sendTestReminder(db, setDB)) {
      alert(t('settings_reminder_no_effects'));
    }
    setRuntimeState(getReminderRuntimeState());
  };

  const handleRunDebugCheck = () => {
    runReminderDebugCheck(() => db, setDB);
    setRuntimeState(getReminderRuntimeState());
  };

  const handleClearDebugLog = () => {
    updateReminderSettings((current) => ({
      ...current,
      debugLog: [],
    }));
  };

  const getNextFireLabel = (timeStr: string) => {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const diffMs = next.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMinutes = Math.floor((diffMs % 3600000) / 60000);

    if (diffHours === 0 && diffMinutes <= 1) return t('soon');
    if (diffHours === 0) return t('settings_reminder_in_min', diffMinutes);
    if (diffHours < 24) return t('settings_reminder_in_hour', diffHours);
    return t('settings_reminder_tomorrow');
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

  const formatDebugDateTime = (value: string | number | null) => {
    if (!value) return t('settings_reminder_debug_none');
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return t('settings_reminder_debug_none');
    return new Intl.DateTimeFormat(db.settings.lang === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const latestTrigger = reminder.debugLog.find((entry) =>
    entry.type === 'trigger' || entry.type === 'preview' || entry.type === 'recovery');

  const formatDebugReason = (reason: string) => {
    const key = `settings_reminder_debug_reason_${reason.replace(/-/g, '_')}`;
    const translated = t(key);
    return translated === key ? reason : translated;
  };

  const formatDebugSource = (source: string) => {
    const key = `settings_reminder_debug_source_${source}`;
    const translated = t(key);
    return translated === key ? source : translated;
  };

  const formatPermissionLabel = () => {
    switch (permissionStatus.state) {
      case PERM.GRANTED:
        return t('settings_reminder_guide_granted_title');
      case PERM.DENIED:
        return t('settings_reminder_guide_denied_title');
      case PERM.DEFAULT:
        return t('settings_reminder_guide_default_title');
      case 'ios-wrong-browser':
        return t('settings_reminder_guide_browser_title');
      case 'ios-too-old':
        return t('settings_reminder_guide_upgrade_title');
      case 'needs-pwa':
        return t('settings_reminder_guide_pwa_title');
      default:
        return t('settings_reminder_guide_not_supported_title');
    }
  };

  const formatEffectList = (effects: string[]) => {
    if (!effects.length) return t('settings_reminder_debug_none');

    const labels = effects.map((effect) => {
      switch (effect) {
        case 'systemNotif':
          return t('settings_reminder_effect_system');
        case 'inAppPopup':
          return t('settings_reminder_effect_popup');
        case 'vibration':
          return t('settings_reminder_effect_vibration');
        case 'sound':
          return t('settings_reminder_effect_sound');
        default:
          return effect;
      }
    });

    return labels.join(' / ');
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

  const effectItems = [
    {
      key: 'systemNotif' as const,
      icon: <Bell className="h-4 w-4" />,
      label: t('settings_reminder_effect_system'),
      desc: !systemNotificationsSupported
        ? t('settings_reminder_effect_system_unavailable')
        : notificationsGranted
          ? t('settings_reminder_effect_system_desc')
          : t('settings_reminder_effect_system_need_permission'),
      checked: reminderEffects.systemNotif,
      disabled: !systemNotificationsSupported,
    },
    {
      key: 'inAppPopup' as const,
      icon: <AppWindow className="h-4 w-4" />,
      label: t('settings_reminder_effect_popup'),
      desc: t('settings_reminder_effect_popup_desc'),
      checked: reminderEffects.inAppPopup,
      disabled: false,
    },
    {
      key: 'vibration' as const,
      icon: <Smartphone className="h-4 w-4" />,
      label: t('settings_reminder_effect_vibration'),
      desc: vibrationSupported
        ? t('settings_reminder_effect_vibration_desc')
        : t('settings_reminder_effect_vibration_unsupported'),
      checked: reminderEffects.vibration,
      disabled: !vibrationSupported,
    },
    {
      key: 'sound' as const,
      icon: <Volume2 className="h-4 w-4" />,
      label: t('settings_reminder_effect_sound'),
      desc: t('settings_reminder_effect_sound_desc'),
      checked: reminderEffects.sound,
      disabled: false,
    },
  ];

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
              className="relative inline-flex h-10 w-[3.75rem] shrink-0 cursor-pointer items-center"
              aria-label={t('settings_reminder_toggle_label')}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={reminder.enabled}
                onChange={(e) => handleToggleReminder(e.target.checked)}
              />
              <span className="h-8 w-14 rounded-full bg-slate-200 transition peer-checked:bg-teal-600" />
              <span className="pointer-events-none absolute left-[3px] top-[5px] h-7 w-7 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-6" />
            </label>
          </div>

          {renderPermissionGuide()}

          <div className="px-5 py-4">
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
                          {formatReminderDisplayTime(time, db.settings.lang)}
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

          <div className="border-t border-slate-100 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t('settings_reminder_effects')}
            </p>

            <div className="mt-3">
              {effectItems.map((item) => (
                <label
                  key={item.key}
                  className={cn(
                    'flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0',
                    item.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 text-slate-400">{item.icon}</div>
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.desc}</span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={item.checked}
                    disabled={item.disabled}
                    onChange={(e) =>
                      handleUpdateEffect(item.key, e.target.checked, { disabled: item.disabled })
                    }
                  />
                  <span className="relative h-6 w-10 shrink-0 rounded-full bg-slate-200 transition after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-teal-600 peer-checked:after:translate-x-4 peer-disabled:bg-slate-200/80" />
                </label>
              ))}
            </div>

            {vibrationSupported && reminderEffects.vibration ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_vibration_pattern')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.keys(VIBRATION_PATTERNS).map((pattern) => {
                    const active = reminder.vibrationPattern === pattern;
                    return (
                      <button
                        key={pattern}
                        type="button"
                        onClick={() =>
                          handleSetVibrationPattern(pattern as ReminderSettings['vibrationPattern'])
                        }
                        className={cn(
                          'min-h-[36px] rounded-xl border px-3 py-2 text-xs font-medium transition',
                          active
                            ? 'border-teal-300 bg-teal-50 text-teal-700'
                            : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {t(`settings_reminder_vibration_${pattern}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {reminderEffects.sound ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_sound_type')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SOUND_TYPES.map((soundType) => {
                    const active = reminder.soundType === soundType;
                    return (
                      <button
                        key={soundType}
                        type="button"
                        onClick={() => handleSetSoundType(soundType)}
                        className={cn(
                          'min-h-[36px] rounded-xl border px-3 py-2 text-xs font-medium transition',
                          active
                            ? 'border-teal-300 bg-teal-50 text-teal-700'
                            : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {t(`settings_reminder_sound_${soundType}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-100 px-5 py-4">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-xs leading-6 text-slate-500">
                  <strong>{t('settings_reminder_important')}</strong> {t('settings_reminder_important_desc')}
                </p>
                <button
                  type="button"
                  onClick={handlePreviewReminder}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
                >
                  {t('settings_reminder_preview')}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_debug_title')}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {t('settings_reminder_debug_desc')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRunDebugCheck}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {t('settings_reminder_debug_action_check')}
                </button>
                <button
                  type="button"
                  onClick={handleClearDebugLog}
                  disabled={reminder.debugLog.length === 0}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('settings_reminder_debug_action_clear')}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_debug_status')}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {runtimeState.isRunning
                    ? t('settings_reminder_debug_running')
                    : t('settings_reminder_debug_stopped')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t('settings_reminder_debug_source')}: {runtimeState.lastCheckSource
                    ? formatDebugSource(runtimeState.lastCheckSource)
                    : t('settings_reminder_debug_none')}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_debug_last_check')}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {formatDebugDateTime(runtimeState.lastCheckAt)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t('settings_reminder_debug_next_check')}: {formatDebugDateTime(runtimeState.nextCheckAt)}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_debug_last_trigger')}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {latestTrigger ? formatDebugDateTime(latestTrigger.createdAt) : t('settings_reminder_debug_none')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {latestTrigger?.scheduledTime
                    ? `${t('settings_reminder_debug_scheduled')}: ${formatReminderDisplayTime(latestTrigger.scheduledTime, db.settings.lang)}`
                    : t('settings_reminder_debug_empty')}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t('settings_reminder_debug_permission')}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatPermissionLabel()}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t('settings_reminder_debug_visibility')}: {document.visibilityState === 'visible'
                    ? t('settings_reminder_debug_visible')
                    : t('settings_reminder_debug_hidden')}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">
                  {t('settings_reminder_debug_log_title')}
                </p>
              </div>

              {reminder.debugLog.length === 0 ? (
                <div className="px-4 py-5 text-sm text-slate-500">
                  {t('settings_reminder_debug_empty')}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {reminder.debugLog.map((entry) => (
                    <div key={entry.id} className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                          {t(`settings_reminder_debug_entry_${entry.type}`)}
                        </span>
                        <span className="text-xs text-slate-500">{formatDebugDateTime(entry.createdAt)}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{formatDebugSource(entry.source)}</span>
                      </div>

                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {formatDebugReason(entry.reason)}
                      </p>

                      <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <p>
                          {t('settings_reminder_debug_scheduled')}: {entry.scheduledTime
                            ? formatReminderDisplayTime(entry.scheduledTime, db.settings.lang)
                            : t('settings_reminder_debug_none')}
                        </p>
                        <p>
                          {t('settings_reminder_debug_due_count')}: {entry.dueCount ?? t('settings_reminder_debug_none')}
                        </p>
                        <p>
                          {t('settings_reminder_debug_effects_requested')}: {formatEffectList(entry.requestedEffects)}
                        </p>
                        <p>
                          {t('settings_reminder_debug_effects_delivered')}: {formatEffectList(entry.deliveredEffects)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
