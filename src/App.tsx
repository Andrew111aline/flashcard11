/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { DBContext, loadDB, saveDB } from './lib/db';
import { DB } from './types';
import { startReminderChecker, checkAndFireReminders, getNotifPermission, PERM } from './lib/reminder';
import { normalizeDB } from './lib/notes';

// Placeholder components for pages
import { Home } from './pages/Home';
import { Decks } from './pages/Decks';
import { Review } from './pages/Review';
import { Stats } from './pages/Stats';
import { Settings } from './pages/Settings';
import { CardEditor } from './pages/CardEditor';

export default function App() {
  const [db, setDBState] = useState<DB>(loadDB());
  const [hash, setHash] = useState(window.location.hash || '#home');

  const setDB = useCallback((newDB: DB | ((prev: DB) => DB)) => {
    setDBState((prev) => {
      const updated = typeof newDB === 'function' ? newDB(prev) : newDB;
      const normalized = normalizeDB(updated);
      saveDB(normalized);
      return normalized;
    });
  }, []);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || '#home');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Initialize reminder checker
  useEffect(() => {
    document.documentElement.lang = db.settings.lang === 'zh' ? 'zh-CN' : 'en';

    if (db.settings.reminder?.enabled && getNotifPermission() === PERM.GRANTED) {
      startReminderChecker(() => db, setDB);
    }
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndFireReminders(() => db, setDB);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [db.settings.reminder?.enabled, db.settings.lang, db, setDB]);

  const renderPage = () => {
    const path = hash.split('?')[0];
    switch (path) {
      case '#home': return <Home />;
      case '#decks': return <Decks />;
      case '#review': return <Review />;
      case '#stats': return <Stats />;
      case '#settings': return <Settings />;
      case '#edit': return <CardEditor />;
      default: return <Home />;
    }
  };

  return (
    <DBContext.Provider value={{ db, setDB }}>
      <Layout>
        {renderPage()}
      </Layout>
    </DBContext.Provider>
  );
}

