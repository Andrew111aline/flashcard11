import { unzipSync, strFromU8 } from 'fflate';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Card, DB, Deck, Note, NoteType } from '../types';
import { uuid } from './fsrs';
import { extractClozeGroups, generateCardsFromNote, summarizeQuality } from './notes';
import type { TextImportSummary } from './importers';

interface ImportedNoteDraft {
  type: NoteType;
  deckName: string;
  front: string;
  back: string;
  extra: string;
  hint: string;
  source: string;
  tags: string[];
  clozeSrc: string;
  title: string;
  content: string;
}

interface AnkiModelMeta {
  id: string;
  name: string;
  type: number;
  fields: string[];
  templateCount: number;
}

interface AnkiDeckMeta {
  id: string;
  name: string;
}

interface AnkiNoteRow {
  id: string;
  modelId: string;
  tags: string[];
  fields: string[];
}

interface AnkiCardRow {
  deckId: string;
  ord: number;
}

type AnkiFieldKind =
  | 'front'
  | 'back'
  | 'cloze'
  | 'options'
  | 'extra'
  | 'hint'
  | 'source'
  | 'title'
  | 'content'
  | 'ignore'
  | 'other';

interface AnkiFieldEntry {
  name: string;
  kind: AnkiFieldKind;
  value: string;
}

interface AnkiMediaAsset {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  dataUrl: string | null;
}

interface AnkiMediaIndex {
  byKey: Map<string, AnkiMediaAsset>;
  byName: Map<string, AnkiMediaAsset>;
}

const IMPORT_DECK_COLORS = [
  '#0d9488',
  '#0284c7',
  '#4f46e5',
  '#9333ea',
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#475569',
];

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export async function importAnkiPackage({
  currentDB,
  file,
  lang,
}: {
  currentDB: DB;
  file: File;
  lang: 'zh' | 'en';
}): Promise<{ db: DB; summary: TextImportSummary }> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const collection = selectCollectionDatabase(archive);
  if (!collection) throw new Error('No collection database found in apkg');

  const SQL = await getSqlJs();
  const sqlite = new SQL.Database(collection);

  try {
    const models = readAnkiModels(sqlite);
    const decks = readAnkiDecks(sqlite);
    const cardsByNote = readAnkiCardsByNote(sqlite);
    const notes = readAnkiNotes(sqlite);
    const media = buildAnkiMediaIndex(archive);

    if (notes.length === 0) throw new Error('No notes found in apkg');

    const deckRegistry = createDeckRegistry(currentDB.decks, file.name);
    const existingSignatures = new Set(currentDB.notes.map((note) => createNoteSignature(note)));
    const importedNotes: Note[] = [];
    const importedCards: Card[] = [];
    let skippedDuplicates = 0;

    notes.forEach((noteRow) => {
      const draft = mapAnkiNoteToDraft(noteRow, {
        models,
        decks,
        cardsByNote,
        media,
        fallbackDeckName: buildDefaultDeckName(file.name),
      });
      if (!draft) return;

      const deckId = deckRegistry.resolve(draft.deckName);
      const note = materializeDraft(draft, deckId, lang);
      if (!isImportableNote(note)) return;

      const signature = createNoteSignature(note);
      if (existingSignatures.has(signature)) {
        skippedDuplicates += 1;
        return;
      }

      existingSignatures.add(signature);
      importedNotes.push(note);
      importedCards.push(...generateCardsFromNote(note));
    });

    return {
      db: {
        ...currentDB,
        decks: deckRegistry.decks,
        notes: [...currentDB.notes, ...importedNotes],
        cards: [...currentDB.cards, ...importedCards],
      },
      summary: {
        importedNotes: importedNotes.length,
        importedCards: importedCards.length,
        createdDecks: deckRegistry.createdCount(),
        skippedDuplicates,
      },
    };
  } finally {
    sqlite.close();
  }
}

async function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }
  return sqlJsPromise;
}

function selectCollectionDatabase(archive: Record<string, Uint8Array>) {
  const preferred = archive['collection.anki21'];
  if (preferred?.length) return preferred;
  const fallback = archive['collection.anki2'];
  if (fallback?.length) return fallback;
  return null;
}

function readAnkiModels(sqlite: Database) {
  const raw = readSingleSqlValue(sqlite, 'select models from col');
  const parsed = safeJsonParse<Record<string, Record<string, unknown>>>(raw, {});
  const models = new Map<string, AnkiModelMeta>();

  Object.entries(parsed).forEach(([id, value]) => {
    models.set(String(id), {
      id: String(id),
      name: asString(value?.name),
      type: asNumber(value?.type, 0),
      fields: Array.isArray(value?.flds)
        ? value.flds.map((field) => asString((field as Record<string, unknown>)?.name))
        : [],
      templateCount: Array.isArray(value?.tmpls) ? value.tmpls.length : 0,
    });
  });

  return models;
}

function readAnkiDecks(sqlite: Database) {
  const raw = readSingleSqlValue(sqlite, 'select decks from col');
  const parsed = safeJsonParse<Record<string, Record<string, unknown>>>(raw, {});
  const decks = new Map<string, AnkiDeckMeta>();

  Object.entries(parsed).forEach(([id, value]) => {
    decks.set(String(id), {
      id: String(id),
      name: asString(value?.name) || 'Imported',
    });
  });

  return decks;
}

function readAnkiCardsByNote(sqlite: Database) {
  const result = sqlite.exec('select nid, did, ord from cards order by nid asc, ord asc');
  const rows = result[0]?.values || [];
  const cardsByNote = new Map<string, AnkiCardRow[]>();

  rows.forEach((row) => {
    const noteId = String(row[0] ?? '');
    const next = cardsByNote.get(noteId) || [];
    next.push({
      deckId: String(row[1] ?? ''),
      ord: asNumber(row[2], 0),
    });
    cardsByNote.set(noteId, next);
  });

  return cardsByNote;
}

function readAnkiNotes(sqlite: Database) {
  const result = sqlite.exec('select id, mid, tags, flds from notes');
  const rows = result[0]?.values || [];

  return rows.map((row) => ({
    id: String(row[0] ?? ''),
    modelId: String(row[1] ?? ''),
    tags: parseAnkiTags(asString(row[2])),
    fields: asString(row[3]).split('\x1f'),
  }));
}

function readSingleSqlValue(sqlite: Database, query: string) {
  const result = sqlite.exec(query);
  return asString(result[0]?.values?.[0]?.[0]);
}

function buildAnkiMediaIndex(archive: Record<string, Uint8Array>): AnkiMediaIndex {
  const byKey = new Map<string, AnkiMediaAsset>();
  const byName = new Map<string, AnkiMediaAsset>();
  const mediaEntry = archive.media;
  if (!mediaEntry?.length) return { byKey, byName };

  const raw = stripBom(strFromU8(mediaEntry));
  const parsed = safeJsonParse<Record<string, string>>(raw, {});

  Object.entries(parsed).forEach(([key, fileName]) => {
    const bytes = archive[key] || archive[fileName];
    if (!bytes?.length) return;

    const asset: AnkiMediaAsset = {
      bytes,
      fileName,
      mimeType: guessMimeType(fileName),
      dataUrl: null,
    };

    byKey.set(String(key), asset);
    byName.set(fileName, asset);
  });

  return { byKey, byName };
}

function mapAnkiNoteToDraft(
  note: AnkiNoteRow,
  context: {
    models: Map<string, AnkiModelMeta>;
    decks: Map<string, AnkiDeckMeta>;
    cardsByNote: Map<string, AnkiCardRow[]>;
    media: AnkiMediaIndex;
    fallbackDeckName: string;
  },
): ImportedNoteDraft | null {
  const model = context.models.get(note.modelId);
  if (!model) return null;

  const cards = context.cardsByNote.get(note.id) || [];
  const deckName =
    context.decks.get(cards[0]?.deckId || '')?.name ||
    context.fallbackDeckName;

  const entries = model.fields.map((fieldName, index) => ({
    name: fieldName,
    kind: classifyAnkiField(fieldName),
    value: normalizeImportedField(
      rewriteAnkiMediaReferences(note.fields[index] || '', context.media),
      true,
    ),
  }));

  const noteType = inferAnkiNoteType(model, cards, entries);
  if (noteType === 'cloze') {
    return buildClozeDraft(entries, note.tags, deckName);
  }

  return buildBasicDraft(entries, note.tags, deckName, noteType);
}

function inferAnkiNoteType(model: AnkiModelMeta, cards: AnkiCardRow[], entries: AnkiFieldEntry[]): NoteType {
  if (model.type === 1 || entries.some((entry) => containsClozeSyntax(entry.value))) return 'cloze';

  if (
    cards.length === 2 &&
    model.templateCount === 2 &&
    entries.some((entry) => entry.kind === 'front') &&
    entries.some((entry) => entry.kind === 'back')
  ) {
    return 'basic-reversed';
  }

  return 'basic';
}

function buildBasicDraft(entries: AnkiFieldEntry[], tags: string[], deckName: string, type: NoteType): ImportedNoteDraft {
  const draft = createEmptyDraft(type, deckName, tags);
  const frontCandidates = getValuesByKind(entries, ['front', 'title']);
  const backCandidates = getValuesByKind(entries, ['back', 'content']);
  const optionCandidates = getValuesByKind(entries, ['options']);
  const extraCandidates = getValuesByKind(entries, ['extra']);
  const hintCandidates = getValuesByKind(entries, ['hint']);
  const sourceCandidates = getValuesByKind(entries, ['source']);
  const genericCandidates = getValuesByKind(entries, ['other']);

  draft.front = joinText(frontCandidates[0] || genericCandidates[0] || '', joinText(...optionCandidates));
  draft.back = backCandidates[0] || genericCandidates[1] || '';
  draft.extra = joinText(...extraCandidates, ...genericCandidates.slice(2));
  draft.hint = joinText(...hintCandidates);
  draft.source = joinText(...sourceCandidates);

  return draft;
}

function buildClozeDraft(entries: AnkiFieldEntry[], tags: string[], deckName: string): ImportedNoteDraft {
  const draft = createEmptyDraft('cloze', deckName, tags);
  const clozeCandidates = getValuesByKind(entries, ['cloze', 'front', 'title', 'content', 'other']);
  const extraCandidates = getValuesByKind(entries, ['extra', 'back', 'content']);
  const sourceCandidates = getValuesByKind(entries, ['source']);

  draft.clozeSrc = clozeCandidates.find((value) => containsClozeSyntax(value)) || clozeCandidates[0] || '';
  draft.extra = joinText(...extraCandidates);
  draft.source = joinText(...sourceCandidates);

  return draft;
}

function getValuesByKind(entries: AnkiFieldEntry[], kinds: AnkiFieldKind[]) {
  return entries
    .filter((entry) => kinds.includes(entry.kind))
    .map((entry) => entry.value)
    .filter(Boolean);
}

function classifyAnkiField(name: string): AnkiFieldKind {
  const normalized = normalizeFieldKey(name);
  if (!normalized) return 'other';

  if (['front', 'question', 'prompt', 'term', 'stem', '题目', '问题', '正面'].includes(normalized)) return 'front';
  if (['back', 'answer', 'definition', 'meaning', 'response', '答案', '背面'].includes(normalized)) return 'back';
  if (['cloze', 'text', 'sentence', '填空', '句子'].includes(normalized)) return 'cloze';
  if (['options', 'choices', 'choice', '选项'].includes(normalized)) return 'options';
  if (['extra', 'analysis', 'explanation', 'note', 'notes', 'commentary', '解析', '说明', '备注'].includes(normalized)) return 'extra';
  if (['hint', 'tip', 'mnemonic', '提示', '技巧'].includes(normalized)) return 'hint';
  if (['source', 'reference', 'context', 'section', 'chapter', 'unit', 'topic', 'type', '来源', '出处', '章节', '分类', '类型'].includes(normalized)) return 'source';
  if (['title', '标题'].includes(normalized)) return 'title';
  if (['content', 'body', '正文', '内容'].includes(normalized)) return 'content';
  if (['id', 'no', 'number', '编号', '序号'].includes(normalized)) return 'ignore';

  return 'other';
}

function normalizeFieldKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function rewriteAnkiMediaReferences(raw: string, media: AnkiMediaIndex) {
  return String(raw || '')
    .replace(/\[sound:([^\]\n]+?)\]/gi, (_, reference) => {
      const resolved = resolveAnkiMediaUrl(String(reference).trim(), media);
      return resolved ? `[sound:${resolved}]` : '';
    })
    .replace(/(<(?:img|audio|source)\b[^>]*?\s(?:src|href)=["'])([^"']+)(["'][^>]*>)/gi, (_, prefix, reference, suffix) => {
      const resolved = resolveAnkiMediaUrl(String(reference).trim(), media);
      return resolved ? `${prefix}${resolved}${suffix}` : '';
    });
}

function resolveAnkiMediaUrl(reference: string, media: AnkiMediaIndex) {
  const direct = media.byKey.get(reference) || media.byName.get(reference);
  if (!direct) return reference;

  if (!direct.dataUrl) {
    direct.dataUrl = `data:${direct.mimeType};base64,${bytesToBase64(direct.bytes)}`;
  }

  return direct.dataUrl;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function guessMimeType(fileName: string) {
  const lower = String(fileName || '').toLowerCase();
  if (/\.(png)$/i.test(lower)) return 'image/png';
  if (/\.(jpe?g)$/i.test(lower)) return 'image/jpeg';
  if (/\.(gif)$/i.test(lower)) return 'image/gif';
  if (/\.(webp)$/i.test(lower)) return 'image/webp';
  if (/\.(svg)$/i.test(lower)) return 'image/svg+xml';
  if (/\.(mp3)$/i.test(lower)) return 'audio/mpeg';
  if (/\.(wav)$/i.test(lower)) return 'audio/wav';
  if (/\.(ogg|oga)$/i.test(lower)) return 'audio/ogg';
  if (/\.(m4a)$/i.test(lower)) return 'audio/mp4';
  return 'application/octet-stream';
}

function createEmptyDraft(type: NoteType, deckName: string, tags: string[]): ImportedNoteDraft {
  return {
    type,
    deckName,
    front: '',
    back: '',
    extra: '',
    hint: '',
    source: '',
    tags,
    clozeSrc: '',
    title: '',
    content: '',
  };
}

function materializeDraft(draft: ImportedNoteDraft, deckId: string, lang: 'zh' | 'en'): Note {
  const now = new Date().toISOString();
  const note: Note = {
    id: uuid(),
    deckId,
    type: draft.type,
    fields: {
      front: draft.front,
      back: draft.back,
      extra: draft.extra,
      hint: draft.hint,
      tags: uniqueStrings(draft.tags),
      source: draft.source,
      title: draft.title,
      content: draft.content,
    },
    clozeSrc: draft.clozeSrc,
    createdAt: now,
    updatedAt: now,
    quality: {
      score: 100,
      issues: [],
    },
  };

  return {
    ...note,
    quality: summarizeQuality(note, lang),
  };
}

function isImportableNote(note: Note) {
  if (note.type === 'cloze') return extractClozeGroups(note.clozeSrc).length > 0;
  if (note.type === 'note-only') return Boolean(note.fields.title.trim() || note.fields.content.trim());
  return Boolean(note.fields.front.trim() && note.fields.back.trim());
}

function createDeckRegistry(existingDecks: Deck[], fileName: string) {
  const decks = [...existingDecks];
  const byName = new Map(existingDecks.map((deck) => [normalizeDeckKey(deck.name), deck]));
  let createdDecks = 0;

  return {
    decks,
    resolve(rawName: string) {
      const name = sanitizeDeckName(rawName) || buildDefaultDeckName(fileName);
      const key = normalizeDeckKey(name);
      const existing = byName.get(key);
      if (existing) return existing.id;

      const deck: Deck = {
        id: uuid(),
        name,
        description: '',
        color: pickDeckColor(name),
        createdAt: new Date().toISOString(),
      };

      decks.push(deck);
      byName.set(key, deck);
      createdDecks += 1;
      return deck.id;
    },
    createdCount() {
      return createdDecks;
    },
  };
}

function pickDeckColor(name: string) {
  const hash = Array.from(String(name || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return IMPORT_DECK_COLORS[hash % IMPORT_DECK_COLORS.length];
}

function createNoteSignature(note: Note) {
  const tags = [...note.fields.tags].map(normalizeSignatureText).filter(Boolean).sort().join('|');
  if (note.type === 'cloze') {
    return [
      note.type,
      note.deckId,
      normalizeSignatureText(note.clozeSrc),
      normalizeSignatureText(note.fields.extra),
      normalizeSignatureText(note.fields.source),
      tags,
    ].join('::');
  }

  return [
    note.type,
    note.deckId,
    normalizeSignatureText(note.fields.front),
    normalizeSignatureText(note.fields.back),
    normalizeSignatureText(note.fields.extra),
    normalizeSignatureText(note.fields.hint),
    normalizeSignatureText(note.fields.source),
    tags,
  ].join('::');
}

function normalizeSignatureText(value: string) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeImportedField(raw: string, allowHtml: boolean) {
  const input = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!input) return '';
  const rendered = shouldTreatAsHtml(input, allowHtml) ? htmlFragmentToMarkdownish(input) : input;
  return rendered
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shouldTreatAsHtml(input: string, allowHtml: boolean) {
  if (allowHtml) return true;
  return /<\/?[a-z][^>]*>|&(?:nbsp|amp|lt|gt|quot|#39);/i.test(input);
}

function htmlFragmentToMarkdownish(input: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${input}</body>`, 'text/html');
  return cleanupMarkdownish(serializeNodes(Array.from(doc.body.childNodes)));
}

function serializeNodes(nodes: ChildNode[]): string {
  return nodes.map((node) => serializeNode(node)).join('');
}

function serializeNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = serializeNodes(Array.from(element.childNodes));

  if (tag === 'br') return '\n';
  if (tag === 'hr') return '\n---\n';
  if (tag === 'img') {
    const alt = element.getAttribute('alt') || '';
    const src = element.getAttribute('src') || '';
    return src ? `![${alt}](${src})` : alt;
  }
  if (tag === 'audio' || tag === 'source') {
    const src = element.getAttribute('src') || '';
    return src ? `[sound:${src}]` : '';
  }
  if (tag === 'strong' || tag === 'b') return `**${children.trim()}**`;
  if (tag === 'em' || tag === 'i') return `*${children.trim()}*`;
  if (tag === 'code') return `\`${children.trim()}\``;
  if (tag === 'pre') return children.trim() ? `\n\`\`\`\n${children.trim()}\n\`\`\`\n` : '';
  if (tag === 'a') {
    const href = element.getAttribute('href') || '';
    const label = children.trim() || href;
    return href ? `[${label}](${href})` : label;
  }
  if (tag === 'li') {
    const body = cleanupMarkdownish(children).trim();
    return body ? `- ${body}\n` : '';
  }
  if (['ul', 'ol'].includes(tag)) return `${children.trim()}\n\n`;
  if (['p', 'div', 'section', 'article', 'blockquote', 'details', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const body = cleanupMarkdownish(children).trim();
    return body ? `${body}\n\n` : '';
  }

  return children;
}

function cleanupMarkdownish(value: string) {
  return String(value || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function containsClozeSyntax(value: string) {
  return /\{\{c\d+::[\s\S]+?\}\}/i.test(String(value || ''));
}

function parseAnkiTags(value: string) {
  return uniqueStrings(
    String(value || '')
      .trim()
      .split(/\s+/)
      .map((item) => item.trim()),
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function joinText(...values: string[]) {
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeDeckName(value: string) {
  return String(value || '')
    .trim()
    .replace(/\s{2,}/g, ' ');
}

function normalizeDeckKey(value: string) {
  return sanitizeDeckName(value).toLowerCase();
}

function buildDefaultDeckName(fileName: string) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return base || 'Imported';
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
