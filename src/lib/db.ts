import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { DB } from '../types';

const STORAGE_KEY = 'fsrs_flashcard_db';

const defaultDB: DB = {
  decks: [],
  cards: [],
  reviews: [],
  settings: {
    lang: 'zh',
    retention: 0.9,
    maxInterval: 36500,
    dailyNewCards: 20,
    reminder: {
      enabled: false,
      times: [],
      lastFired: {}
    }
  }
};

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultDB;
  } catch {
    return defaultDB;
  }
}

export function saveDB(db: DB) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    console.error('Failed to save DB', e);
  }
}

interface DBContextType {
  db: DB;
  setDB: (db: DB | ((prev: DB) => DB)) => void;
}

export const DBContext = createContext<DBContextType | null>(null);

export function useDB() {
  const context = useContext(DBContext);
  if (!context) {
    throw new Error('useDB must be used within a DBProvider');
  }
  return context;
}

import { getTranslation } from './i18n';

export function useTranslation() {
  const { db } = useDB();
  const lang = db.settings.lang || 'zh';
  
  const t = (key: string, ...args: any[]) => {
    if (key === 'lang') return lang;
    return getTranslation(lang, key, ...args);
  };
  
  return t;
}
