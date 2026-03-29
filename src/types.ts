export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type NoteType = 'basic' | 'basic-reversed' | 'cloze' | 'note-only';
export type QualitySeverity = 'error' | 'warning' | 'info';

export interface Deck {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
}

export interface NoteFields {
  front: string;
  back: string;
  extra: string;
  hint: string;
  tags: string[];
  source: string;
  title: string;
  content: string;
}

export interface NoteQualitySnapshot {
  score: number;
  issues: string[];
}

export interface Note {
  id: string;
  deckId: string;
  type: NoteType;
  fields: NoteFields;
  clozeSrc: string;
  createdAt: string;
  updatedAt: string;
  quality: NoteQualitySnapshot;
}

export interface Card {
  id: string;
  noteId: string;
  deckId: string;
  ordinal: number;
  state: CardState;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  step: number;
  dueAt: string;
  lastReview: string | null;
  createdAt: string;
}

export interface CardQualityIssue {
  id: string;
  severity: QualitySeverity;
  message: string;
}

export interface CardQualityResult {
  score: number;
  issues: CardQualityIssue[];
}

export interface ReviewLog {
  cardId: string;
  rating: number; // 1=Again, 2=Hard, 3=Good, 4=Easy
  state: CardState;
  scheduledDays: number;
  reviewedAt: string;
}

export interface ReminderSettings {
  enabled: boolean;
  times: string[];
  lastFired: Record<string, boolean>;
}

export interface Settings {
  lang: 'zh' | 'en';
  retention: number;
  maxInterval: number;
  dailyNewCards: number;
  reminder: ReminderSettings;
}

export interface DB {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
  reviews: ReviewLog[];
  settings: Settings;
}
