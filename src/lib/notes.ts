import {
  Card,
  CardQualityResult,
  CardState,
  DB,
  Deck,
  Note,
  NoteFields,
  NoteType,
  ReminderDebugType,
  ReminderDebugLogEntry,
  ReminderDebugSource,
  ReminderEffectKey,
  ReminderEffects,
  ReviewLog,
  Settings,
  SoundType,
  VibrationPattern,
} from '../types';
import { uuid } from './fsrs';
import {
  createDefaultReminderSettings,
  DEFAULT_SOUND_TYPE,
  DEFAULT_VIBRATION_PATTERN,
} from './reminder';

type ClozeGroupMap = Record<string, { full: string; answer: string; hint: string }[]>;

const VALID_NOTE_TYPES: NoteType[] = ['basic', 'basic-reversed', 'cloze', 'note-only'];
const VALID_CARD_STATES: CardState[] = ['new', 'learning', 'review', 'relearning'];

function nowIso() {
  return new Date().toISOString();
}

export function createDefaultDB(): DB {
  return {
    decks: [],
    notes: [],
    cards: [],
    reviews: [],
    settings: {
      lang: 'zh',
      retention: 0.9,
      maxInterval: 36500,
      dailyNewCards: 20,
      reminder: createDefaultReminderSettings(),
    },
  };
}

export function createEmptyNote(deckId = ''): Note {
  const createdAt = nowIso();
  return {
    id: '',
    deckId,
    type: 'basic',
    fields: createEmptyNoteFields(),
    clozeSrc: '',
    createdAt,
    updatedAt: createdAt,
    quality: {
      score: 100,
      issues: [],
    },
  };
}

export function createEmptyNoteFields(): NoteFields {
  return {
    front: '',
    back: '',
    extra: '',
    hint: '',
    tags: [],
    source: '',
    title: '',
    content: '',
  };
}

export function splitTags(value: string | string[]) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCloze(text: string): ClozeGroupMap {
  const source = String(text || '');
  const pattern = /\{\{c(\d+)::([\s\S]+?)\}\}/g;
  const groups: ClozeGroupMap = {};
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const full = match[0];
    const groupId = match[1];
    const body = match[2];
    const separatorIndex = body.indexOf('::');
    const answer = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
    const hint = separatorIndex >= 0 ? body.slice(separatorIndex + 2) : '';

    if (!answer.trim()) continue;

    groups[groupId] ??= [];
    groups[groupId].push({
      full,
      answer: answer.trim(),
      hint: hint.trim(),
    });
  }

  return groups;
}

export function extractClozeGroups(clozeSrc: string) {
  return Object.keys(parseCloze(clozeSrc)).sort((a, b) => Number(a) - Number(b));
}

export function getCardVariantCount(note: Note) {
  if (note.type === 'note-only') return 1;
  return generateCardsFromNote(note).length;
}

export function getClozeGroupIdByOrdinal(note: Note, ordinal: number) {
  return extractClozeGroups(note.clozeSrc)[ordinal] || null;
}

export function getNoteTitle(note: Note) {
  const raw =
    note.type === 'cloze'
      ? stripMarkdown(note.clozeSrc)
      : note.type === 'note-only'
        ? note.fields.title || note.fields.content
        : note.fields.front;

  return truncateText(raw || 'Untitled', 72);
}

export function getNoteSummary(note: Note) {
  if (note.type === 'note-only') {
    return truncateText(stripMarkdown(note.fields.content || note.fields.source), 96);
  }

  if (note.type === 'cloze') {
    return truncateText(stripMarkdown(note.fields.extra || note.fields.source), 96);
  }

  return truncateText(stripMarkdown(note.fields.back || note.fields.extra || note.fields.source), 96);
}

export function noteProducesCards(note: Note) {
  return note.type !== 'note-only';
}

export function generateCardsFromNote(note: Note, existingCards: Card[] = []): Card[] {
  if (!noteProducesCards(note)) return [];

  const createdAt = note.createdAt || nowIso();
  const existingByOrdinal = new Map(existingCards.map((card) => [card.ordinal, normalizeScheduleCard(card)]));
  const ordinals =
    note.type === 'basic'
      ? [0]
      : note.type === 'basic-reversed'
        ? [0, 1]
        : extractClozeGroups(note.clozeSrc).map((_, index) => index);

  return ordinals.map((ordinal) => {
    const existing = existingByOrdinal.get(ordinal);
    return {
      id: existing?.id || uuid(),
      noteId: note.id,
      deckId: note.deckId,
      ordinal,
      state: existing?.state || 'new',
      stability: existing?.stability || 0,
      difficulty: existing?.difficulty || 5,
      elapsedDays: existing?.elapsedDays || 0,
      scheduledDays: existing?.scheduledDays || 0,
      reps: existing?.reps || 0,
      lapses: existing?.lapses || 0,
      step: existing?.step || 0,
      dueAt: existing?.dueAt || createdAt,
      lastReview: existing?.lastReview || null,
      createdAt: existing?.createdAt || createdAt,
    };
  });
}

export function checkCardQuality(note: Note, lang: 'zh' | 'en' = 'zh'): CardQualityResult {
  if (note.type === 'note-only') {
    return {
      score: 100,
      issues: [],
    };
  }

  const messages = QUALITY_MESSAGES[lang] || QUALITY_MESSAGES.zh;
  const issues: CardQualityResult['issues'] = [];
  const addIssue = (id: keyof typeof QUALITY_MESSAGES.zh, severity: 'error' | 'warning' | 'info') => {
    issues.push({ id, severity, message: messages[id] });
  };

  if (note.type === 'cloze') {
    const clozeSrc = note.clozeSrc || '';
    const groups = extractClozeGroups(clozeSrc);
    if (!clozeSrc.trim()) {
      addIssue('cloze_empty', 'error');
    } else if (groups.length === 0) {
      addIssue('cloze_invalid', 'error');
    }
    if (groups.length > 5) addIssue('cloze_too_many_blanks', 'warning');
    if (!note.fields.source.trim()) addIssue('missing_source', 'info');
  } else {
    const front = stripMarkdown(note.fields.front || '');
    const back = stripMarkdown(note.fields.back || '');
    const listItems = (note.fields.back || '').match(/^\s*(?:[-*]|\d+\.)\s+/gm) || [];
    const questionMarks = (note.fields.front.match(/[?？]/g) || []).length;
    const hasAnd = /\b(?:and|with)\b|和|与|以及|并且|同时|&/.test(note.fields.front);

    if (!front.trim()) addIssue('front_required', 'error');
    if (!back.trim()) addIssue('back_required', 'error');
    if (front.length > 120) addIssue('front_too_long', 'warning');
    if (back.length > 300) addIssue('back_too_long', 'warning');
    if (questionMarks > 1 || (questionMarks === 1 && hasAnd)) addIssue('multiple_questions', 'error');
    if (listItems.length >= 3) addIssue('list_in_back', 'warning');
    if (front.length > 0 && front.length <= 5 && !/[?？]/.test(note.fields.front)) addIssue('no_context', 'info');
    if (back.length > 100 && !stripMarkdown(note.fields.extra || '').trim()) addIssue('empty_extra_for_complex', 'info');
    if (!note.fields.source.trim()) addIssue('missing_source', 'info');
  }

  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === 'error') return sum + 30;
    if (issue.severity === 'warning') return sum + 15;
    return sum + 5;
  }, 0);

  return {
    score: Math.max(0, 100 - penalty),
    issues,
  };
}

export function summarizeQuality(note: Note, lang: 'zh' | 'en' = 'zh') {
  const result = checkCardQuality(note, lang);
  return {
    score: result.score,
    issues: result.issues.map((issue) => issue.id),
  };
}

export function escapeHtml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderRichText(text: string, htmlReplacements: Record<string, string> = {}) {
  let working = String(text || '').replace(/\r\n/g, '\n');
  const replacements = { ...htmlReplacements };
  let tokenIndex = Object.keys(replacements).length;
  const createToken = (html: string) => {
    const token = `HTML_TOKEN_${tokenIndex++}_X`;
    replacements[token] = html;
    return token;
  };

  working = working
    .replace(/\[sound:([^\]\n]+?)\]/gi, (_, rawUrl) => {
      const url = sanitizeMediaUrl(String(rawUrl).trim());
      if (!url) return '';
      return createToken(`<audio controls preload="none" class="note-audio" src="${escapeHtml(url)}"></audio>`);
    })
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) =>
      createToken(`<div class="note-math note-math-block">${escapeHtml(String(formula).trim())}</div>`),
    )
    .replace(/\$([^\n$]+?)\$/g, (_, formula) =>
      createToken(`<span class="note-math note-math-inline">${escapeHtml(String(formula).trim())}</span>`),
    );

  const html = markdownToHtml(working);

  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replaceAll(token, value),
    html,
  );
}

export function stripMarkdown(text: string) {
  return String(text || '')
    .replace(/\{\{c\d+::([\s\S]+?)\}\}/g, (_, body) => {
      const content = String(body);
      const separatorIndex = content.indexOf('::');
      return separatorIndex >= 0 ? content.slice(0, separatorIndex) : content;
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[sound:([^\]\n]+?)\]/gi, ' ')
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/\$([^\n$]+?)\$/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCardRenderModel(note: Note, ordinal = 0) {
  const baseFields =
    note.type === 'basic-reversed' && ordinal === 1
      ? {
          front: note.fields.back,
          back: note.fields.front,
        }
      : {
          front: note.fields.front,
          back: note.fields.back,
        };

  if (note.type === 'cloze') {
    return buildClozeRenderModel(note, ordinal);
  }

  if (note.type === 'note-only') {
    return {
      frontHtml: renderRichText(note.fields.title || note.fields.content || ''),
      backHtml: renderRichText(note.fields.content || note.fields.title || ''),
      backContextHtml: note.fields.title
        ? renderRichText(note.fields.title)
        : undefined,
      extraHtml: undefined,
      hint: '',
      source: note.fields.source,
    };
  }

  return {
    frontHtml: renderRichText(baseFields.front),
    backHtml: renderRichText(baseFields.back),
    backContextHtml: renderRichText(baseFields.front),
    extraHtml: note.fields.extra ? renderRichText(note.fields.extra) : undefined,
    hint: note.fields.hint,
    source: note.fields.source,
  };
}

export function normalizeDB(raw: unknown): DB {
  const fallback = createDefaultDB();
  if (!raw || typeof raw !== 'object') return fallback;

  const data = raw as Record<string, unknown>;
  const settings = normalizeSettings(data.settings);
  const lang = settings.lang;
  const decks = Array.isArray(data.decks) ? data.decks.map(normalizeDeck).filter(Boolean) as Deck[] : [];
  const reviews = Array.isArray(data.reviews)
    ? data.reviews.map(normalizeReviewLog).filter(Boolean) as ReviewLog[]
    : [];

  const rawNotes = Array.isArray(data.notes) ? data.notes : [];
  const rawCards = Array.isArray(data.cards) ? data.cards : [];

  const normalizedNotes: Note[] = rawNotes.map((item) => normalizeNote(item, lang)).filter(Boolean) as Note[];
  const existingCardMap = new Map<string, Card[]>();
  const legacyNotes: Note[] = [];
  const legacyCards: Card[] = [];

  rawCards.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const rawCard = item as Record<string, unknown>;

    if (typeof rawCard.noteId === 'string') {
      const normalized = normalizeScheduleCard(rawCard);
      existingCardMap.set(rawCard.noteId, [...(existingCardMap.get(rawCard.noteId) || []), normalized]);
      return;
    }

    if (typeof rawCard.front === 'string' || typeof rawCard.back === 'string') {
      const migrated = migrateLegacyCard(rawCard, lang);
      legacyNotes.push(migrated.note);
      legacyCards.push(migrated.card);
    }
  });

  const notes = [...normalizedNotes, ...legacyNotes].map((note) => ({
    ...note,
    quality: summarizeQuality(note, lang),
  }));

  const cards = notes.flatMap((note) => {
    if (!noteProducesCards(note)) return [];
    const existing = existingCardMap.get(note.id);
    if (!existing || existing.length === 0) {
      const migrated = legacyCards.filter((card) => card.noteId === note.id);
      return generateCardsFromNote(note, migrated);
    }
    return generateCardsFromNote(note, existing);
  });

  return {
    decks,
    notes,
    cards,
    reviews,
    settings,
  };
}

function normalizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== 'object') return null;
  const deck = raw as Record<string, unknown>;
  return {
    id: asString(deck.id) || uuid(),
    name: asString(deck.name) || 'Untitled Deck',
    description: asString(deck.description),
    color: asString(deck.color) || '#0d9488',
    createdAt: asIsoString(deck.createdAt) || nowIso(),
  };
}

function normalizeSettings(raw: unknown): Settings {
  const fallback = createDefaultDB().settings;
  if (!raw || typeof raw !== 'object') return fallback;

  const settings = raw as Record<string, unknown>;
  const reminder = settings.reminder && typeof settings.reminder === 'object'
    ? (settings.reminder as Record<string, unknown>)
    : {};
  const reminderEffects = reminder.effects && typeof reminder.effects === 'object'
    ? (reminder.effects as Record<string, unknown>)
    : {};
  const defaultReminder = createDefaultReminderSettings();
  const vibrationPattern = asString(reminder.vibrationPattern);
  const soundType = asString(reminder.soundType);
  const debugLog = Array.isArray(reminder.debugLog)
    ? reminder.debugLog
        .map(normalizeReminderDebugLogEntry)
        .filter(Boolean) as ReminderDebugLogEntry[]
    : [];

  return {
    lang: settings.lang === 'en' ? 'en' : 'zh',
    retention: asNumber(settings.retention, fallback.retention),
    maxInterval: asNumber(settings.maxInterval, fallback.maxInterval),
    dailyNewCards: asNumber(settings.dailyNewCards, fallback.dailyNewCards),
    reminder: {
      enabled: Boolean(reminder.enabled),
      times: Array.isArray(reminder.times)
        ? reminder.times.map((item) => String(item)).filter(Boolean)
        : [],
      lastFired:
        reminder.lastFired && typeof reminder.lastFired === 'object'
          ? Object.fromEntries(
              Object.entries(reminder.lastFired as Record<string, unknown>).map(([key, value]) => [key, Boolean(value)]),
            )
          : {},
      effects: {
        systemNotif: readReminderEffect(reminderEffects, 'systemNotif', defaultReminder.effects.systemNotif),
        inAppPopup: readReminderEffect(reminderEffects, 'inAppPopup', defaultReminder.effects.inAppPopup),
        vibration: readReminderEffect(reminderEffects, 'vibration', defaultReminder.effects.vibration),
        sound: readReminderEffect(reminderEffects, 'sound', defaultReminder.effects.sound),
      },
      vibrationPattern: isVibrationPattern(vibrationPattern) ? vibrationPattern : DEFAULT_VIBRATION_PATTERN,
      soundType: isSoundType(soundType) ? soundType : DEFAULT_SOUND_TYPE,
      debugLog,
    },
  };
}

function normalizeReviewLog(raw: unknown): ReviewLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const review = raw as Record<string, unknown>;
  return {
    cardId: asString(review.cardId) || uuid(),
    rating: asNumber(review.rating, 3),
    state: VALID_CARD_STATES.includes(review.state as CardState) ? (review.state as CardState) : 'review',
    scheduledDays: asNumber(review.scheduledDays, 0),
    reviewedAt: asIsoString(review.reviewedAt) || nowIso(),
  };
}

function normalizeNote(raw: unknown, lang: 'zh' | 'en'): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const type = VALID_NOTE_TYPES.includes(item.type as NoteType) ? (item.type as NoteType) : 'basic';
  const rawFields =
    item.fields && typeof item.fields === 'object'
      ? (item.fields as Record<string, unknown>)
      : {};

  const note: Note = {
    id: asString(item.id) || uuid(),
    deckId: asString(item.deckId),
    type,
    fields: {
      front: asString(rawFields.front ?? item.front),
      back: asString(rawFields.back ?? item.back),
      extra: asString(rawFields.extra),
      hint: asString(rawFields.hint),
      tags: splitTags((rawFields.tags as string[] | string) ?? (item.tags as string[] | string) ?? []),
      source: asString(rawFields.source),
      title: asString(rawFields.title),
      content: asString(rawFields.content),
    },
    clozeSrc: asString(item.clozeSrc),
    createdAt: asIsoString(item.createdAt) || nowIso(),
    updatedAt: asIsoString(item.updatedAt) || asIsoString(item.createdAt) || nowIso(),
    quality: {
      score: asNumber(item.quality && typeof item.quality === 'object' ? (item.quality as Record<string, unknown>).score : undefined, 100),
      issues:
        item.quality && typeof item.quality === 'object' && Array.isArray((item.quality as Record<string, unknown>).issues)
          ? ((item.quality as Record<string, unknown>).issues as unknown[]).map((issue) => String(issue))
          : [],
    },
  };

  return {
    ...note,
    quality: summarizeQuality(note, lang),
  };
}

function migrateLegacyCard(rawCard: Record<string, unknown>, lang: 'zh' | 'en') {
  const createdAt = asIsoString(rawCard.createdAt) || nowIso();
  const noteId = `note-${asString(rawCard.id) || uuid()}`;
  const note: Note = {
    id: noteId,
    deckId: asString(rawCard.deckId),
    type: 'basic',
    fields: {
      front: asString(rawCard.front),
      back: asString(rawCard.back),
      extra: '',
      hint: '',
      tags: splitTags((rawCard.tags as string[] | string) ?? []),
      source: '',
      title: '',
      content: '',
    },
    clozeSrc: '',
    createdAt,
    updatedAt: createdAt,
    quality: {
      score: 100,
      issues: [],
    },
  };

  return {
    note: {
      ...note,
      quality: summarizeQuality(note, lang),
    },
    card: {
      ...normalizeScheduleCard(rawCard),
      id: asString(rawCard.id) || uuid(),
      noteId,
      deckId: asString(rawCard.deckId),
      ordinal: 0,
      createdAt,
    },
  };
}

function normalizeScheduleCard(raw: unknown): Card {
  const item = raw as Record<string, unknown>;
  return {
    id: asString(item.id) || uuid(),
    noteId: asString(item.noteId),
    deckId: asString(item.deckId),
    ordinal: asNumber(item.ordinal, 0),
    state: VALID_CARD_STATES.includes(item.state as CardState) ? (item.state as CardState) : 'new',
    stability: asNumber(item.stability, 0),
    difficulty: asNumber(item.difficulty, 5),
    elapsedDays: asNumber(item.elapsedDays, 0),
    scheduledDays: asNumber(item.scheduledDays, 0),
    reps: asNumber(item.reps, 0),
    lapses: asNumber(item.lapses, 0),
    step: asNumber(item.step, 0),
    dueAt: asIsoString(item.dueAt) || nowIso(),
    lastReview: asIsoString(item.lastReview) || null,
    createdAt: asIsoString(item.createdAt) || nowIso(),
  };
}

function buildClozeRenderModel(note: Note, ordinal: number) {
  const groups = parseCloze(note.clozeSrc);
  const orderedGroups = extractClozeGroups(note.clozeSrc);
  const targetGroupId = orderedGroups[ordinal];
  const replacementsForFront: Record<string, string> = {};
  const replacementsForBack: Record<string, string> = {};
  let replacementIndex = 0;

  Object.entries(groups).forEach(([groupId, items]) => {
    items.forEach((item) => {
      const tokenFront = `CLOZE_FRONT_${replacementIndex}_X`;
      const tokenBack = `CLOZE_BACK_${replacementIndex}_X`;
      replacementIndex += 1;

      if (groupId === targetGroupId) {
        const label = item.hint || '___';
        replacementsForFront[tokenFront] = `<span class="cloze-blank">${escapeHtml(label)}</span>`;
        replacementsForBack[tokenBack] = `<span class="cloze-answer">${escapeHtml(item.answer)}</span>`;
      } else {
        const other = `<span class="cloze-other">${escapeHtml(item.answer)}</span>`;
        replacementsForFront[tokenFront] = other;
        replacementsForBack[tokenBack] = other;
      }
    });
  });

  let frontSource = note.clozeSrc;
  let backSource = note.clozeSrc;
  let cursor = 0;

  Object.entries(groups).forEach(([groupId, items]) => {
    items.forEach((item) => {
      const tokenFront = `CLOZE_FRONT_${cursor}_X`;
      const tokenBack = `CLOZE_BACK_${cursor}_X`;
      cursor += 1;
      frontSource = frontSource.replace(item.full, tokenFront);
      backSource = backSource.replace(item.full, groupId === targetGroupId ? tokenBack : tokenBack);
    });
  });

  return {
    frontHtml: renderRichText(frontSource, replacementsForFront),
    backHtml: renderRichText(backSource, replacementsForBack),
    backContextHtml: undefined,
    extraHtml: note.fields.extra ? renderRichText(note.fields.extra) : undefined,
    hint: '',
    source: note.fields.source,
  };
}

function markdownToHtml(text: string) {
  const lines = text.split('\n');
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre class="note-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level} class="note-heading note-heading-${level}">${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        index += 1;
      }
      html.push(
        `<${ordered ? 'ol' : 'ul'} class="note-list">${items
          .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
          .join('')}</${ordered ? 'ol' : 'ul'}>`,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p class="note-paragraph">${renderInlineMarkdown(paragraph.join('<br />'))}</p>`);
  }

  return html.join('');
}

function renderInlineMarkdown(text: string) {
  let html = escapeHtml(text);

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, altText, rawUrl) => {
    const url = sanitizeMediaUrl(String(rawUrl).trim());
    const alt = String(altText).trim();
    if (!url) return alt;
    return `<img src="${url}" alt="${alt}" loading="lazy" class="note-image" />`;
  });
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="note-link">$1</a>',
  );
  html = html.replace(/`([^`]+)`/g, '<code class="note-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return html;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readReminderEffect(
  effects: Record<string, unknown>,
  key: keyof ReminderEffects,
  fallback: boolean,
) {
  return effects[key] === undefined ? fallback : Boolean(effects[key]);
}

function normalizeReminderDebugLogEntry(raw: unknown): ReminderDebugLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw as Record<string, unknown>;
  const type = asString(item.type);
  const source = asString(item.source);
  const requestedEffects = Array.isArray(item.requestedEffects)
    ? item.requestedEffects.map((effect) => String(effect)).filter(isReminderEffectKey)
    : [];
  const deliveredEffects = Array.isArray(item.deliveredEffects)
    ? item.deliveredEffects.map((effect) => String(effect)).filter(isReminderEffectKey)
    : [];

  return {
    id: asString(item.id) || `reminder-log-${Date.now()}`,
    createdAt: asIsoString(item.createdAt) || nowIso(),
    type: isReminderDebugType(type) ? type : 'check',
    source: isReminderDebugSource(source) ? source : 'manual',
    reason: asString(item.reason) || 'unknown',
    scheduledTime: asString(item.scheduledTime) || null,
    dueCount: typeof item.dueCount === 'number' && Number.isFinite(item.dueCount) ? item.dueCount : null,
    requestedEffects,
    deliveredEffects,
  };
}

function isVibrationPattern(value: string): value is VibrationPattern {
  return ['gentle', 'standard', 'strong', 'pulse'].includes(value);
}

function isSoundType(value: string): value is SoundType {
  return ['bell', 'chime', 'ping'].includes(value);
}

function isReminderEffectKey(value: string): value is ReminderEffectKey {
  return ['systemNotif', 'inAppPopup', 'vibration', 'sound'].includes(value);
}

function isReminderDebugSource(value: string): value is ReminderDebugSource {
  return ['interval', 'visibility', 'focus', 'startup', 'manual'].includes(value);
}

function isReminderDebugType(value: string): value is ReminderDebugType {
  return ['trigger', 'preview', 'check', 'recovery'].includes(value);
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asIsoString(value: unknown) {
  if (typeof value !== 'string') return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

function truncateText(text: string, limit: number) {
  const source = String(text || '').trim();
  if (source.length <= limit) return source;
  return `${source.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function sanitizeMediaUrl(value: string) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url)) return url;
  if (/^data:(image|audio)\//i.test(url)) return url;
  return '';
}

const QUALITY_MESSAGES = {
  zh: {
    front_required: '正面内容不能为空。',
    back_required: '背面内容不能为空。',
    cloze_empty: '填空文本不能为空。',
    cloze_invalid: '未检测到有效的完形填空语法，请使用 {{c1::答案}}。',
    front_too_long: '正面内容较长，建议拆成更原子的提问。',
    back_too_long: '背面内容过多，建议把解释移到“额外信息”字段。',
    multiple_questions: '正面看起来包含多个问题，建议一卡只保留一个知识点。',
    list_in_back: '背面出现较长列表，建议改成 Cloze 或拆分多张卡。',
    no_context: '问题略显孤立，补一点语境会更容易记住。',
    cloze_too_many_blanks: '同一条笔记里的填空太多，建议拆分成更短的句子。',
    empty_extra_for_complex: '这张卡内容偏复杂，可以把解释放进“额外信息”字段。',
    missing_source: '补充来源或使用语境，通常会让回忆更稳。',
  },
  en: {
    front_required: 'Front content is required.',
    back_required: 'Back content is required.',
    cloze_empty: 'Cloze text is required.',
    cloze_invalid: 'No valid cloze syntax found. Use {{c1::answer}}.',
    front_too_long: 'Front is long. Consider splitting it into a smaller prompt.',
    back_too_long: 'Back is dense. Move explanation to the Extra field.',
    multiple_questions: 'Front appears to ask multiple questions. Keep one card to one idea.',
    list_in_back: 'Back contains a long list. Consider Cloze or splitting it up.',
    no_context: 'The prompt is isolated. A little context may improve recall.',
    cloze_too_many_blanks: 'There are many cloze deletions here. Consider splitting the sentence.',
    empty_extra_for_complex: 'This card is fairly complex. The Extra field may help.',
    missing_source: 'Adding source or context often improves recall.',
  },
} as const;
