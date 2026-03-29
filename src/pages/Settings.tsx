import React, { useState, useEffect } from 'react';
import { useDB, useTranslation } from '../lib/db';
import { Save, Download, Upload, AlertTriangle, Trash2, Bell, BellOff, Info, X, Plus, Globe } from 'lucide-react';
import { getNotifPermission, requestPermission, PERM, PermissionState, startReminderChecker, sendTestNotification } from '../lib/reminder';

export function Settings() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const [retention, setRetention] = useState(db.settings.retention * 100);
  const [maxInterval, setMaxInterval] = useState(db.settings.maxInterval);
  const [dailyNewCards, setDailyNewCards] = useState(db.settings.dailyNewCards);
  
  // Reminder State
  const [reminderEnabled, setReminderEnabled] = useState(db.settings.reminder?.enabled || false);
  const [reminderTimes, setReminderTimes] = useState<string[]>(db.settings.reminder?.times || []);
  const [permission, setPermission] = useState<PermissionState>(getNotifPermission());

  useEffect(() => {
    setPermission(getNotifPermission());
  }, []);

  const handleSave = () => {
    setDB(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        retention: retention / 100,
        maxInterval,
        dailyNewCards,
        reminder: {
          enabled: reminderEnabled,
          times: reminderTimes,
          lastFired: prev.settings.reminder?.lastFired || {}
        }
      }
    }));
    
    if (reminderEnabled && permission === PERM.GRANTED) {
      // Need to pass the getter and setter, but we can just rely on App.tsx's effect 
      // which will restart it when db changes.
    }
    
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
        if (data.decks && data.cards && data.settings) {
          if (confirm(t('settings_import_confirm'))) {
            setDB(data);
            alert(t('settings_import_success'));
          }
        } else {
          alert(t('settings_import_invalid'));
        }
      } catch (err) {
        alert(t('settings_import_fail'));
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const handleClear = () => {
    if (confirm(t('settings_clear_confirm'))) {
      if (confirm(t('settings_clear_confirm2'))) {
        setDB({
          decks: [],
          cards: [],
          reviews: [],
          settings: {
            lang: db.settings.lang,
            retention: 0.9,
            maxInterval: 36500,
            dailyNewCards: 20,
            reminder: {
              enabled: false,
              times: [],
              lastFired: {}
            }
          }
        });
        alert(t('settings_clear_success'));
      }
    }
  };

  const handleRequestPermission = async () => {
    const res = await requestPermission();
    setPermission(res);
  };

  const handleAddReminderTime = () => {
    if (reminderTimes.length >= 5) return;
    
    let defaultTime = '09:00';
    const existing = new Set(reminderTimes);
    const candidates = ['09:00', '12:00', '18:00', '20:00', '22:00'];
    for (const t of candidates) {
      if (!existing.has(t)) {
        defaultTime = t;
        break;
      }
    }
    
    const newTimes = [...reminderTimes, defaultTime].sort();
    setReminderTimes(newTimes);
  };

  const handleRemoveReminderTime = (index: number) => {
    const newTimes = [...reminderTimes];
    newTimes.splice(index, 1);
    setReminderTimes(newTimes);
  };

  const handleUpdateReminderTime = (index: number, val: string) => {
    if (!val) return;
    if (reminderTimes.includes(val) && reminderTimes.indexOf(val) !== index) {
      alert(t('settings_reminder_exists'));
      return;
    }
    const newTimes = [...reminderTimes];
    newTimes[index] = val;
    newTimes.sort();
    setReminderTimes(newTimes);
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

  const switchLang = (lang: 'zh' | 'en') => {
    setDB(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        lang
      }
    }));
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('settings_title')}</h1>

      <div className="space-y-8">
        {/* Language Settings */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Globe className="w-5 h-5 text-teal-600" />
            {t('settings_lang')}
          </h2>
          
          <div className="flex gap-4">
            <button
              onClick={() => switchLang('zh')}
              className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                db.settings.lang === 'zh' 
                  ? 'border-teal-600 bg-teal-50 text-teal-700 font-bold' 
                  : 'border-gray-200 text-gray-600 hover:border-teal-200 hover:bg-gray-50'
              }`}
            >
              {t('settings_lang_zh')}
            </button>
            <button
              onClick={() => switchLang('en')}
              className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                db.settings.lang === 'en' 
                  ? 'border-teal-600 bg-teal-50 text-teal-700 font-bold' 
                  : 'border-gray-200 text-gray-600 hover:border-teal-200 hover:bg-gray-50'
              }`}
            >
              {t('settings_lang_en')}
            </button>
          </div>
        </div>

        {/* FSRS Algorithm Settings */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-6">{t('settings_fsrs')}</h2>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">{t('settings_retention')}</label>
                <span className="text-sm font-bold text-teal-600">{retention}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="99"
                value={retention}
                onChange={e => setRetention(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
              />
              <p className="text-xs text-gray-500 mt-2">
                {t('settings_retention_desc')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings_max_interval')}</label>
                <input
                  type="number"
                  min="1"
                  value={maxInterval}
                  onChange={e => setMaxInterval(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings_new_cards')}</label>
                <input
                  type="number"
                  min="1"
                  value={dailyNewCards}
                  onChange={e => setDailyNewCards(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-teal-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                {t('common_save')}
              </button>
            </div>
          </div>
        </div>

        {/* Reminder Settings */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Bell className="w-5 h-5 text-teal-600" />
                {t('settings_reminder')}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{t('settings_reminder_desc')}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                disabled={permission !== PERM.GRANTED && permission !== PERM.DEFAULT}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
          </div>

          <div className="space-y-4">
            {permission === PERM.NOT_SUPPORTED && (
              <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg flex items-start gap-3 border border-yellow-200">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{t('settings_reminder_unsupported')}</p>
              </div>
            )}
            
            {permission === PERM.DENIED && (
              <div className="p-4 bg-red-50 text-red-800 rounded-lg flex items-start gap-3 border border-red-200">
                <BellOff className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{t('settings_reminder_denied')}</p>
              </div>
            )}

            {permission === PERM.DEFAULT && (
              <div className="p-4 bg-blue-50 text-blue-800 rounded-lg flex items-center justify-between border border-blue-200">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{t('settings_reminder_grant')}</p>
                </div>
                <button 
                  onClick={handleRequestPermission}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  {t('settings_reminder_enable')}
                </button>
              </div>
            )}

            <div className={`transition-opacity duration-200 ${(!reminderEnabled || (permission !== PERM.GRANTED && permission !== PERM.DEFAULT)) ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700">{t('settings_reminder_times')}</h3>
                <button 
                  onClick={handleAddReminderTime}
                  disabled={reminderTimes.length >= 5}
                  className="text-teal-600 hover:text-teal-700 text-sm font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" /> {t('settings_reminder_add')}
                </button>
              </div>

              {reminderTimes.length === 0 ? (
                <p className="text-sm text-gray-500 italic text-center py-4 border border-dashed border-gray-200 rounded-lg">
                  {t('settings_reminder_empty')}
                </p>
              ) : (
                <div className="space-y-3">
                  {reminderTimes.map((time, idx) => (
                    <div key={idx} className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                      <input 
                        type="time" 
                        value={time}
                        onChange={(e) => handleUpdateReminderTime(idx, e.target.value)}
                        className="bg-white border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                      <span className="text-xs text-gray-500 flex-1">{getNextFireLabel(time)}</span>
                      <button 
                        onClick={() => handleRemoveReminderTime(idx)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        aria-label="Remove time"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="mt-6 flex items-start gap-2 text-xs text-gray-500">
                <Info className="w-4 h-4 shrink-0" />
                <p>
                  <strong>{t('settings_reminder_important')}</strong> {t('settings_reminder_important_desc')}
                </p>
              </div>
              
              <div className="mt-4 flex justify-end">
                 <button 
                  onClick={() => sendTestNotification(db.settings.lang)}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                 >
                   {t('settings_reminder_test')}
                 </button>
              </div>
            </div>
          </div>
        </div>

        {/* Data Management */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-6">{t('settings_data')}</h2>
          
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div>
                <h3 className="font-medium text-gray-900">{t('settings_export')}</h3>
                <p className="text-sm text-gray-500">{t('settings_export_desc')}</p>
              </div>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                {t('settings_export_btn')}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div>
                <h3 className="font-medium text-gray-900">{t('settings_import')}</h3>
                <p className="text-sm text-gray-500">{t('settings_import_desc')}</p>
              </div>
              <label className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap">
                <Upload className="w-4 h-4" />
                {t('settings_import_btn')}
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-red-50 rounded-lg border border-red-100 mt-8">
              <div>
                <h3 className="font-medium text-red-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {t('settings_danger')}
                </h3>
                <p className="text-sm text-red-700">{t('settings_danger_desc')}</p>
              </div>
              <button
                onClick={handleClear}
                className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                {t('settings_clear')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
