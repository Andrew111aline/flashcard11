import { Card, Settings } from '../types';
import { getTranslation } from './i18n';

export class FSRS {
  w: number[];
  requestRetention: number;
  maximumInterval: number;
  learningSteps: number[];
  relearningSteps: number[];

  constructor(settings: Partial<Settings> = {}) {
    this.w = [
      0.40255, 1.18385, 3.173, 15.69105,
      7.1949, 0.5345, 1.4604, 0.0046,
      1.54575, 0.1192, 1.01925, 1.9395,
      0.11, 0.29605, 2.2698, 0.2315,
      2.9898, 0.51655, 0.6621
    ];
    this.requestRetention = settings.retention || 0.9;
    this.maximumInterval = settings.maxInterval || 36500;
    this.learningSteps = [1, 10];
    this.relearningSteps = [10];
  }

  forgettingCurve(elapsedDays: number, stability: number) {
    const F = 19 / 81, C = -0.5;
    return Math.pow(1 + F * elapsedDays / stability, C);
  }

  nextInterval(stability: number) {
    const F = 19 / 81;
    const r = this.requestRetention;
    const interval = (stability / F) * (Math.pow(r, -2) - 1);
    return Math.min(Math.max(Math.round(interval), 1), this.maximumInterval);
  }

  initStability(rating: number) {
    return Math.max(this.w[rating - 1], 0.1);
  }

  initDifficulty(rating: number) {
    const d = this.w[4] - Math.exp(this.w[5] * (rating - 1)) + 1;
    return Math.min(Math.max(d, 1), 10);
  }

  nextDifficulty(d: number, rating: number) {
    const delta = -this.w[6] * (rating - 3);
    const dp = d + delta * (10 - d) / 9;
    const mean = this.w[7] * this.initDifficulty(4) + (1 - this.w[7]) * dp;
    return Math.min(Math.max(mean, 1), 10);
  }

  nextRecallStability(d: number, s: number, r: number, rating: number) {
    const hardPenalty = rating === 2 ? this.w[15] : 1;
    const easyBonus = rating === 4 ? this.w[16] : 1;
    return s * (
      1 + Math.exp(this.w[8])
      * (11 - d)
      * Math.pow(s, -this.w[9])
      * (Math.exp((1 - r) * this.w[10]) - 1)
      * hardPenalty
      * easyBonus
    );
  }

  nextForgetStability(d: number, s: number, r: number) {
    return Math.min(
      this.w[11]
      * Math.pow(d, -this.w[12])
      * (Math.pow(s + 1, this.w[13]) - 1)
      * Math.exp((1 - r) * this.w[14]),
      s
    );
  }

  schedule(card: Card, rating: number, now = new Date()): Card {
    const next = { ...card };
    next.reps += 1;
    next.lastReview = now.toISOString();

    if (card.state === 'new' || card.state === 'learning') {
      if (rating === 1) {
        next.state = 'learning';
        next.step = 0;
        next.dueAt = addMinutes(now, this.learningSteps[0]).toISOString();
      } else if (rating === 2) {
        next.state = 'learning';
        next.dueAt = addMinutes(now, this.learningSteps[next.step] * 1.5).toISOString();
      } else if (rating === 3) {
        const nextStep = (card.step || 0) + 1;
        if (nextStep >= this.learningSteps.length) {
          next.state = 'review';
          next.stability = this.initStability(rating);
          next.difficulty = card.difficulty > 0 ? card.difficulty : this.initDifficulty(rating);
          next.scheduledDays = this.nextInterval(next.stability);
          next.dueAt = addDays(now, next.scheduledDays).toISOString();
        } else {
          next.state = 'learning';
          next.step = nextStep;
          next.dueAt = addMinutes(now, this.learningSteps[nextStep]).toISOString();
        }
      } else {
        next.state = 'review';
        next.stability = this.initStability(rating);
        next.difficulty = this.initDifficulty(rating);
        next.scheduledDays = this.nextInterval(next.stability);
        next.dueAt = addDays(now, next.scheduledDays).toISOString();
      }
    } else if (card.state === 'review') {
      const lastReview = new Date(card.lastReview || card.createdAt);
      const elapsed = Math.max(0, (now.getTime() - lastReview.getTime()) / 86400000);
      const r = this.forgettingCurve(elapsed, card.stability);

      next.elapsedDays = elapsed;

      if (rating === 1) {
        next.state = 'relearning';
        next.lapses += 1;
        next.step = 0;
        next.stability = this.nextForgetStability(card.difficulty, card.stability, r);
        next.difficulty = this.nextDifficulty(card.difficulty, rating);
        next.dueAt = addMinutes(now, this.relearningSteps[0]).toISOString();
      } else {
        next.state = 'review';
        next.stability = this.nextRecallStability(card.difficulty, card.stability, r, rating);
        next.difficulty = this.nextDifficulty(card.difficulty, rating);
        next.scheduledDays = this.nextInterval(next.stability);
        next.dueAt = addDays(now, next.scheduledDays).toISOString();
      }
    } else if (card.state === 'relearning') {
      if (rating === 1) {
        next.state = 'relearning';
        next.step = 0;
        next.dueAt = addMinutes(now, this.relearningSteps[0]).toISOString();
      } else {
        next.state = 'review';
        next.scheduledDays = this.nextInterval(card.stability);
        next.dueAt = addDays(now, next.scheduledDays).toISOString();
      }
    }

    return next;
  }

  previewSchedule(card: Card, now = new Date(), lang: 'zh' | 'en' = 'zh') {
    return {
      1: this._previewLabel(this.schedule(card, 1, now), now, lang),
      2: this._previewLabel(this.schedule(card, 2, now), now, lang),
      3: this._previewLabel(this.schedule(card, 3, now), now, lang),
      4: this._previewLabel(this.schedule(card, 4, now), now, lang),
    };
  }

  _previewLabel(nextCard: Card, now: Date, lang: 'zh' | 'en') {
    const due = new Date(nextCard.dueAt);
    const diff = due.getTime() - now.getTime();
    if (diff < 3600000) return getTranslation(lang, 'fsrs_min', Math.round(diff / 60000));
    if (diff < 86400000) return getTranslation(lang, 'fsrs_hour', Math.round(diff / 3600000));
    return getTranslation(lang, 'fsrs_day', Math.round(diff / 86400000));
  }
}

export function addMinutes(date: Date, m: number) { return new Date(date.getTime() + m * 60000); }
export function addDays(date: Date, d: number) { return new Date(date.getTime() + d * 86400000); }
export function uuid() { return crypto.randomUUID(); }
