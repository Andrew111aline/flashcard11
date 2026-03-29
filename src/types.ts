export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface Deck {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  tags: string[];
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
  cards: Card[];
  reviews: ReviewLog[];
  settings: Settings;
}
