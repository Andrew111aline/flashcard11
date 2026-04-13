import { DB, Note } from '../types';
import {
  buildCardRenderModel,
  generateCardsFromNote,
  getClozeGroupIdByOrdinal,
  noteProducesCards,
  renderRichText,
} from './notes';

export interface ExportFile {
  name: string;
  content: string;
  mimeType: string;
}

const OPEN_STUDY_PACK_FORMAT = 'fsrs-open-study-pack';
const OPEN_STUDY_PACK_VERSION = 1;

export function formatLocalDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildBackupExport(db: DB): ExportFile {
  return {
    name: `fsrs-backup-${formatLocalDateStamp()}.json`,
    content: JSON.stringify(db, null, 2),
    mimeType: 'application/json;charset=utf-8',
  };
}

export function buildOpenStudyPackExport(db: DB): ExportFile {
  return {
    name: `fsrs-open-study-pack-${formatLocalDateStamp()}.json`,
    content: JSON.stringify({
      format: OPEN_STUDY_PACK_FORMAT,
      version: OPEN_STUDY_PACK_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'FSRS Flashcards Web',
      decks: db.decks,
      notes: db.notes,
      cards: db.cards,
      reviews: db.reviews,
      settings: db.settings,
    }, null, 2),
    mimeType: 'application/json;charset=utf-8',
  };
}

export function buildUniversalCsvExport(db: DB): ExportFile {
  const deckNameMap = new Map(db.decks.map((deck) => [deck.id, deck.name]));
  const rows = [
    [
      'deck',
      'note_type',
      'card_variant',
      'front_text',
      'back_text',
      'front_rich',
      'back_rich',
      'extra_rich',
      'hint',
      'source',
      'tags',
      'quality_score',
      'reviewable',
      'state',
      'due_at',
      'last_review',
    ],
  ];

  db.notes.forEach((note) => {
    const deckName = deckNameMap.get(note.deckId) || 'Untitled Deck';
    const tags = joinTags(note.fields.tags);
    const qualityScore = String(note.quality.score);

    if (!noteProducesCards(note)) {
      const frontHtml = renderRichText(note.fields.title || note.fields.content || '');
      const backHtml = renderRichText(note.fields.content || note.fields.title || '');
      rows.push([
        deckName,
        note.type,
        'note',
        stripHtml(frontHtml),
        stripHtml(backHtml),
        frontHtml,
        backHtml,
        '',
        '',
        note.fields.source,
        tags,
        qualityScore,
        'false',
        '',
        '',
        '',
      ]);
      return;
    }

    const existingCards = db.cards.filter((card) => card.noteId === note.id);
    const cards = generateCardsFromNote(note, existingCards);

    cards.forEach((card) => {
      const renderModel = buildCardRenderModel(note, card.ordinal);
      rows.push([
        deckName,
        note.type,
        getCardVariantLabel(note, card.ordinal),
        stripHtml(renderModel.frontHtml),
        stripHtml(renderModel.backHtml),
        renderModel.frontHtml,
        renderModel.backHtml,
        renderModel.extraHtml || '',
        renderModel.hint || '',
        renderModel.source || '',
        tags,
        qualityScore,
        'true',
        card.state,
        card.dueAt,
        card.lastReview || '',
      ]);
    });
  });

  return {
    name: `flashcards-universal-${formatLocalDateStamp()}.csv`,
    content: toDelimited(rows, ','),
    mimeType: 'text/csv;charset=utf-8',
  };
}

export function buildAnkiExportFiles(db: DB): ExportFile[] {
  const deckNameMap = new Map(db.decks.map((deck) => [deck.id, deck.name]));
  const basicRows: string[][] = [];
  const reversedRows: string[][] = [];
  const clozeRows: string[][] = [];

  db.notes.forEach((note) => {
    const deckName = deckNameMap.get(note.deckId) || 'Untitled Deck';
    const tags = joinTags(note.fields.tags);

    if (note.type === 'basic') {
      basicRows.push([
        renderRichText(note.fields.front),
        composeAnkiBackField(note.fields.back, note.fields.extra, note.fields.hint, note.fields.source),
        tags,
        deckName,
      ]);
      return;
    }

    if (note.type === 'basic-reversed') {
      reversedRows.push([
        renderRichText(note.fields.front),
        composeAnkiBackField(note.fields.back, note.fields.extra, note.fields.hint, note.fields.source),
        tags,
        deckName,
      ]);
      return;
    }

    if (note.type === 'cloze') {
      clozeRows.push([
        renderRichText(note.clozeSrc),
        composeAnkiExtraField(note.fields.extra, note.fields.source),
        tags,
        deckName,
      ]);
    }
  });

  return [
    {
      name: `anki-basic-${formatLocalDateStamp()}.tsv`,
      content: buildAnkiTsv(
        ['#separator:Tab', '#html:true', '#tags column:3', '#deck column:4'],
        basicRows,
      ),
      mimeType: 'text/tab-separated-values;charset=utf-8',
    },
    {
      name: `anki-reversed-${formatLocalDateStamp()}.tsv`,
      content: buildAnkiTsv(
        ['#separator:Tab', '#html:true', '#tags column:3', '#deck column:4'],
        reversedRows,
      ),
      mimeType: 'text/tab-separated-values;charset=utf-8',
    },
    {
      name: `anki-cloze-${formatLocalDateStamp()}.tsv`,
      content: buildAnkiTsv(
        ['#separator:Tab', '#html:true', '#tags column:3', '#deck column:4'],
        clozeRows,
      ),
      mimeType: 'text/tab-separated-values;charset=utf-8',
    },
    {
      name: `anki-import-guide-${formatLocalDateStamp()}.md`,
      content: buildAnkiGuide(),
      mimeType: 'text/markdown;charset=utf-8',
    },
  ];
}

export function unwrapImportedDB(raw: unknown): DB | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  if (candidate.format === OPEN_STUDY_PACK_FORMAT) {
    return {
      decks: Array.isArray(candidate.decks) ? candidate.decks : [],
      notes: Array.isArray(candidate.notes) ? candidate.notes : [],
      cards: Array.isArray(candidate.cards) ? candidate.cards : [],
      reviews: Array.isArray(candidate.reviews) ? candidate.reviews : [],
      settings: candidate.settings && typeof candidate.settings === 'object' ? candidate.settings as DB['settings'] : {} as DB['settings'],
    };
  }

  if (Array.isArray(candidate.decks) && candidate.settings && (Array.isArray(candidate.cards) || Array.isArray(candidate.notes))) {
    return candidate as unknown as DB;
  }

  return null;
}

function buildAnkiTsv(metadata: string[], rows: string[][]) {
  return [...metadata, ...rows.map((row) => row.map((cell) => escapeCell(cell, '\t')).join('\t'))].join('\n');
}

function composeAnkiBackField(back: string, extra: string, hint: string, source: string) {
  const sections = [renderRichText(back)];

  if (extra.trim()) {
    sections.push(`<hr><div><strong>Extra</strong><div>${renderRichText(extra)}</div></div>`);
  }
  if (hint.trim()) {
    sections.push(`<div><strong>Hint</strong><div>${renderRichText(hint)}</div></div>`);
  }
  if (source.trim()) {
    sections.push(`<div><strong>Source</strong><div>${renderRichText(source)}</div></div>`);
  }

  return sections.join('');
}

function composeAnkiExtraField(extra: string, source: string) {
  const sections: string[] = [];
  if (extra.trim()) sections.push(renderRichText(extra));
  if (source.trim()) sections.push(`<div><strong>Source</strong><div>${renderRichText(source)}</div></div>`);
  return sections.join('<hr>');
}

function getCardVariantLabel(note: Note, ordinal: number) {
  if (note.type === 'basic') return 'forward';
  if (note.type === 'basic-reversed') return ordinal === 0 ? 'forward' : 'reverse';
  if (note.type === 'cloze') return `cloze-c${getClozeGroupIdByOrdinal(note, ordinal) || ordinal + 1}`;
  return 'note';
}

function joinTags(tags: string[]) {
  return tags
    .map((tag) => String(tag).trim().replace(/\s+/g, '_'))
    .filter(Boolean)
    .join(' ');
}

function toDelimited(rows: string[][], separator: ',' | '\t') {
  return rows.map((row) => row.map((cell) => escapeCell(cell, separator)).join(separator)).join('\n');
}

function escapeCell(value: string, separator: ',' | '\t') {
  const input = String(value || '');
  const escaped = input.replace(/"/g, '""');
  if (escaped.includes(separator) || escaped.includes('\n') || escaped.includes('\r') || escaped.includes('"')) {
    return `"${escaped}"`;
  }
  return escaped;
}

function stripHtml(html: string) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h\d|li|ul|ol|details|summary|pre)>/gi, '\n')
      .replace(/<audio[\s\S]*?<\/audio>/gi, ' [audio] ')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1 ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildAnkiGuide() {
  return [
    '# Anki Import Guide',
    '',
    '1. Import `anki-basic-*.tsv` with note type `Basic`.',
    '2. Import `anki-reversed-*.tsv` with note type `Basic (and reversed card)`.',
    '3. Import `anki-cloze-*.tsv` with note type `Cloze`.',
    '4. Keep HTML import enabled so rich text, images, and audio tags are preserved.',
    '5. If you use `[sound:...]` media references, place the matching files in Anki `collection.media` before import.',
  ].join('\n');
}
