/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from './components/Layout';
import { DBContext, loadDB, saveDB } from './lib/db';
import { DB } from './types';
import {
  hasReminderEffectsEnabled,
  startReminderChecker,
  stopReminderChecker,
} from './lib/reminder';
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
  const dbRef = useRef(db);

  const setDB = useCallback((newDB: DB | ((prev: DB) => DB)) => {
    setDBState((prev) => {
      const updated = typeof newDB === 'function' ? newDB(prev) : newDB;
      const normalized = normalizeDB(updated);
      saveDB(normalized);
      return normalized;
    });
  }, []);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const getCurrentDB = useCallback(() => dbRef.current, []);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || '#home');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = db.settings.lang === 'zh' ? 'zh-CN' : 'en';
  }, [db.settings.lang]);

  useEffect(() => {
    const shouldRunReminderChecker =
      db.settings.reminder?.enabled &&
      db.settings.reminder?.times.length > 0 &&
      hasReminderEffectsEnabled(db.settings.reminder);

    if (shouldRunReminderChecker) {
      startReminderChecker(getCurrentDB, setDB);
    } else {
      stopReminderChecker();
    }

    return () => {
      stopReminderChecker();
    };
  }, [
    db.settings.reminder?.enabled,
    db.settings.reminder?.times,
    db.settings.reminder?.effects,
    getCurrentDB,
    setDB,
  ]);

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

