import { Card, DB, Deck, Note, NoteType } from '../types';
import { uuid } from './fsrs';
import { extractClozeGroups, generateCardsFromNote, summarizeQuality } from './notes';

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

type CanonicalColumn =
  | 'front'
  | 'back'
  | 'cloze'
  | 'extra'
  | 'hint'
  | 'source'
  | 'tags'
  | 'deck'
  | 'noteType'
  | 'title'
  | 'content'
  | 'cardVariant';

interface ParsedTextMeta {
  separator: string;
  html: boolean;
  columns?: string[];
  deckColumn: number | null;
  tagsColumn: number | null;
  noteTypeColumn: number | null;
  defaultDeckName: string;
  globalDeckName: string;
  globalTags: string[];
  globalNoteType: NoteType | null;
}

interface ParsedTextFile {
  rows: string[][];
  meta: ParsedTextMeta;
}

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

export interface TextImportSummary {
  importedNotes: number;
  importedCards: number;
  createdDecks: number;
  skippedDuplicates: number;
}

export async function readImportedTextFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeImportedTextBytes(bytes);
}

export function importExternalTextPackage({
  currentDB,
  fileName,
  content,
  lang,
}: {
  currentDB: DB;
  fileName: string;
  content: string;
  lang: 'zh' | 'en';
}): { db: DB; summary: TextImportSummary } {
  const parsed = parseExternalTextFile(fileName, content);
  if (parsed.rows.length === 0) {
    throw new Error('No importable rows found');
  }

  const deckRegistry = createDeckRegistry(currentDB.decks, fileName);
  const existingSignatures = new Set(currentDB.notes.map((note) => createNoteSignature(note)));
  const importedNotes: Note[] = [];
  const importedCards: Card[] = [];
  let skippedDuplicates = 0;

  parsed.rows.forEach((row) => {
    const draft = mapRowToDraft(row, parsed.meta, fileName);
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
}

function parseExternalTextFile(fileName: string, content: string): ParsedTextFile {
  const source = stripBom(String(content || '')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { headerLines, body } = extractLeadingHeaderLines(source);
  const headerMap = parseHeaderLines(headerLines);
  const separator = resolveSeparator(headerMap.separator) || detectSeparator(body);
  const rows = parseDelimitedRows(body, separator);

  let columns = headerMap.columnsRaw ? splitHeaderColumns(headerMap.columnsRaw, separator) : undefined;
  if (!columns && rows.length > 0 && looksLikeHeaderRow(rows[0])) {
    columns = rows.shift()?.map((cell) => String(cell || '').trim());
  }

  return {
    rows: rows
      .map((row) => row.map((cell) => String(cell || '')))
      .filter((row) => row.some((cell) => cell.trim())),
    meta: {
      separator,
      html: String(headerMap.html || '').toLowerCase() === 'true',
      columns,
      deckColumn: parseColumnIndex(headerMap.deckColumn),
      tagsColumn: parseColumnIndex(headerMap.tagsColumn),
      noteTypeColumn: parseColumnIndex(headerMap.noteTypeColumn),
      defaultDeckName: buildDefaultDeckName(fileName),
      globalDeckName: String(headerMap.deck || '').trim(),
      globalTags: parseImportedTags(headerMap.tags || ''),
      globalNoteType: resolveExternalNoteType(headerMap.noteType || ''),
    },
  };
}

function extractLeadingHeaderLines(source: string) {
  const headerLines: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const nextBreak = source.indexOf('\n', cursor);
    const lineEnd = nextBreak === -1 ? source.length : nextBreak;
    const line = source.slice(cursor, lineEnd);
    const trimmed = line.trim();
    const nextCursor = nextBreak === -1 ? source.length : nextBreak + 1;

    if (!trimmed) {
      cursor = nextCursor;
      continue;
    }

    if (!trimmed.startsWith('#')) break;

    headerLines.push(trimmed);
    cursor = nextCursor;
  }

  return {
    headerLines,
    body: source.slice(cursor),
  };
}

function parseHeaderLines(lines: string[]) {
  const headerMap: Record<string, string> = {};

  lines.forEach((line) => {
    const match = line.match(/^#([^:]+):(.*)$/);
    if (!match) return;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    headerMap[key] = value;
  });

  return {
    separator: headerMap.separator,
    html: headerMap.html,
    columnsRaw: headerMap.columns,
    deckColumn: headerMap['deck column'],
    tagsColumn: headerMap['tags column'],
    noteTypeColumn: headerMap['notetype column'] || headerMap['note type column'],
    deck: headerMap.deck,
    tags: headerMap.tags,
    noteType: headerMap.notetype || headerMap['note type'],
  };
}

function resolveSeparator(raw: string | undefined) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'tab') return '\t';
  if (value === 'comma') return ',';
  if (value === 'semicolon') return ';';
  if (value === 'pipe') return '|';
  if (value === 'space') return ' ';
  if (value === 'colon') return ':';
  return value.charAt(0);
}

function detectSeparator(body: string) {
  const sample = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!sample) return '\t';

  const candidates = ['\t', ',', ';', '|'];
  let best = '\t';
  let bestScore = -1;

  candidates.forEach((candidate) => {
    const score = countSeparator(sample, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

function countSeparator(line: string, separator: string) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === separator) count += 1;
  }

  return count;
}

function parseDelimitedRows(source: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === separator) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(trimTrailingEmptyCells(row));
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  const trimmedRow = trimTrailingEmptyCells(row);
  if (trimmedRow.some((cell) => cell.trim())) rows.push(trimmedRow);

  return rows;
}

function trimTrailingEmptyCells(row: string[]) {
  const next = [...row];
  while (next.length > 1 && !String(next[next.length - 1] || '').trim()) next.pop();
  return next;
}

function splitHeaderColumns(source: string, separator: string) {
  return parseDelimitedRows(source, separator)[0]?.map((cell) => String(cell || '').trim()) || [];
}

function looksLikeHeaderRow(row: string[]) {
  const canonicalColumns = row.map((cell) => getCanonicalColumn(cell)).filter(Boolean) as CanonicalColumn[];
  if (canonicalColumns.length < 2) return false;
  return canonicalColumns.some((item) => ['front', 'back', 'cloze', 'title', 'content'].includes(item));
}

function getCanonicalColumn(value: string): CanonicalColumn | null {
  const normalized = normalizeColumnKey(value);
  if (!normalized) return null;

  if (['front', 'question', 'prompt', 'term'].includes(normalized)) return 'front';
  if (['back', 'answer', 'definition', 'meaning', 'response'].includes(normalized)) return 'back';
  if (['cloze', 'text', 'sentence'].includes(normalized)) return 'cloze';
  if (['extra', 'notes', 'explanation', 'remark', 'remarks'].includes(normalized)) return 'extra';
  if (['hint', 'mnemonic'].includes(normalized)) return 'hint';
  if (['source', 'context', 'reference'].includes(normalized)) return 'source';
  if (['tags', 'tag'].includes(normalized)) return 'tags';
  if (['deck', 'deckname'].includes(normalized)) return 'deck';
  if (['notetype', 'type', 'model'].includes(normalized)) return 'noteType';
  if (['title'].includes(normalized)) return 'title';
  if (['content', 'body', 'note'].includes(normalized)) return 'content';
  if (['cardvariant', 'variant'].includes(normalized)) return 'cardVariant';

  return null;
}

function normalizeColumnKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function parseColumnIndex(raw: string | undefined) {
  const numeric = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric - 1 : null;
}

function mapRowToDraft(row: string[], meta: ParsedTextMeta, fileName: string): ImportedNoteDraft | null {
  const specialValues = readSpecialColumnValues(row, meta);
  const deckName = specialValues.deckName || meta.globalDeckName || meta.defaultDeckName;
  const tags = uniqueStrings([...meta.globalTags, ...specialValues.tags]);

  if (meta.columns?.length) {
    return mapColumnedRowToDraft(row, meta, {
      deckName,
      tags,
      explicitNoteType: specialValues.noteType,
      fileName,
    });
  }

  return mapPositionalRowToDraft(row, meta, {
    deckName,
    tags,
    explicitNoteType: specialValues.noteType,
    fileName,
  });
}

function readSpecialColumnValues(row: string[], meta: ParsedTextMeta) {
  return {
    deckName: readColumn(row, meta.deckColumn).trim(),
    tags: parseImportedTags(readColumn(row, meta.tagsColumn)),
    noteType: resolveExternalNoteType(readColumn(row, meta.noteTypeColumn)),
  };
}

function mapColumnedRowToDraft(
  row: string[],
  meta: ParsedTextMeta,
  options: {
    deckName: string;
    tags: string[];
    explicitNoteType: NoteType | null;
    fileName: string;
  },
): ImportedNoteDraft | null {
  const fieldMap = new Map<CanonicalColumn, string>();

  meta.columns?.forEach((column, index) => {
    const canonical = getCanonicalColumn(column);
    if (!canonical || fieldMap.has(canonical)) return;
    fieldMap.set(canonical, readColumn(row, index));
  });

  const noteType = inferExternalNoteType({
    explicitType: fieldMap.get('noteType') || options.explicitNoteType || meta.globalNoteType,
    fileName: options.fileName,
    primaryCell: fieldMap.get('cloze') || fieldMap.get('front') || '',
  });

  const cardVariant = normalizeColumnKey(fieldMap.get('cardVariant') || '');
  if (noteType === 'basic-reversed' && cardVariant === 'reverse') return null;
  if (cardVariant && noteType === 'cloze' && !fieldMap.get('cloze')) return null;

  const note = createEmptyDraft(noteType, options.deckName, options.tags);

  if (noteType === 'cloze') {
    const rawExtra = fieldMap.get('extra') || fieldMap.get('back') || '';
    note.clozeSrc = normalizeImportedField(fieldMap.get('cloze') || fieldMap.get('front') || '', meta.html);
    const parsedExtra = parseClozeExtraField(rawExtra, meta.html);
    note.extra = parsedExtra.extra;
    note.source = normalizeImportedField(fieldMap.get('source') || '', meta.html) || parsedExtra.source;
    return note;
  }

  if (noteType === 'note-only') {
    note.title = normalizeImportedField(fieldMap.get('title') || fieldMap.get('front') || '', meta.html);
    note.content = normalizeImportedField(fieldMap.get('content') || fieldMap.get('back') || '', meta.html);
    note.source = normalizeImportedField(fieldMap.get('source') || '', meta.html);
    return note;
  }

  note.front = normalizeImportedField(fieldMap.get('front') || '', meta.html);
  const parsedBack = parseBasicBackField(fieldMap.get('back') || '', meta.html);
  note.back = parsedBack.back;
  note.extra = joinText(parsedBack.extra, normalizeImportedField(fieldMap.get('extra') || '', meta.html));
  note.hint = normalizeImportedField(fieldMap.get('hint') || '', meta.html) || parsedBack.hint;
  note.source = normalizeImportedField(fieldMap.get('source') || '', meta.html) || parsedBack.source;
  return note;
}

function mapPositionalRowToDraft(
  row: string[],
  meta: ParsedTextMeta,
  options: {
    deckName: string;
    tags: string[];
    explicitNoteType: NoteType | null;
    fileName: string;
  },
): ImportedNoteDraft | null {
  const specialIndexes = new Set<number>([meta.deckColumn, meta.tagsColumn, meta.noteTypeColumn].filter((value): value is number => value !== null));
  const fields = row.filter((_, index) => !specialIndexes.has(index));
  const noteType = inferExternalNoteType({
    explicitType: options.explicitNoteType || meta.globalNoteType,
    fileName: options.fileName,
    primaryCell: fields[0] || '',
  });

  const note = createEmptyDraft(noteType, options.deckName, options.tags);

  if (noteType === 'cloze') {
    note.clozeSrc = normalizeImportedField(fields[0] || '', meta.html);
    const parsedExtra = parseClozeExtraField(fields[1] || '', meta.html);
    note.extra = joinText(parsedExtra.extra, ...fields.slice(2).map((item) => normalizeImportedField(item, meta.html)));
    note.source = parsedExtra.source;
    return note;
  }

  if (noteType === 'note-only') {
    note.title = normalizeImportedField(fields[0] || '', meta.html);
    note.content = normalizeImportedField(fields[1] || '', meta.html);
    return note;
  }

  note.front = normalizeImportedField(fields[0] || '', meta.html);
  const parsedBack = parseBasicBackField(fields[1] || '', meta.html);
  note.back = parsedBack.back;
  note.extra = joinText(parsedBack.extra, ...fields.slice(2).map((item) => normalizeImportedField(item, meta.html)));
  note.hint = parsedBack.hint;
  note.source = parsedBack.source;
  return note;
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

function inferExternalNoteType({
  explicitType,
  fileName,
  primaryCell,
}: {
  explicitType: string | NoteType | null;
  fileName: string;
  primaryCell: string;
}): NoteType {
  const fromExplicit = resolveExternalNoteType(String(explicitType || ''));
  if (fromExplicit) return fromExplicit;

  if (containsClozeSyntax(primaryCell)) return 'cloze';

  const normalizedFileName = String(fileName || '').toLowerCase();
  if (/revers|双向/.test(normalizedFileName)) return 'basic-reversed';
  if (/cloze|填空/.test(normalizedFileName)) return 'cloze';

  return 'basic';
}

function resolveExternalNoteType(value: string): NoteType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('cloze') || normalized.includes('填空')) return 'cloze';
  if (normalized.includes('reverse') || normalized.includes('reversed') || normalized.includes('双向')) return 'basic-reversed';
  if (normalized.includes('note') || normalized.includes('笔记')) return 'note-only';
  if (normalized.includes('basic') || normalized.includes('基础')) return 'basic';
  return null;
}

function containsClozeSyntax(value: string) {
  return /\{\{c\d+::[\s\S]+?\}\}/i.test(String(value || ''));
}

function parseBasicBackField(raw: string, allowHtml: boolean) {
  const chunks = splitStructuredChunks(raw);
  if (chunks.length <= 1) {
    return {
      back: normalizeImportedField(raw, allowHtml),
      extra: '',
      hint: '',
      source: '',
    };
  }

  const result = {
    back: normalizeImportedField(chunks[0], allowHtml),
    extra: '',
    hint: '',
    source: '',
  };

  chunks.slice(1).forEach((chunk) => {
    const section = detectLabeledSection(normalizeImportedField(chunk, allowHtml));
    if (!section.body) return;
    if (section.label === 'extra') result.extra = joinText(result.extra, section.body);
    if (section.label === 'hint') result.hint = joinText(result.hint, section.body);
    if (section.label === 'source') result.source = joinText(result.source, section.body);
    if (!section.label) result.extra = joinText(result.extra, section.body);
  });

  return result;
}

function parseClozeExtraField(raw: string, allowHtml: boolean) {
  const chunks = splitStructuredChunks(raw);
  if (chunks.length <= 1) {
    return {
      extra: normalizeImportedField(raw, allowHtml),
      source: '',
    };
  }

  const result = {
    extra: '',
    source: '',
  };

  chunks.forEach((chunk, index) => {
    const normalized = normalizeImportedField(chunk, allowHtml);
    if (!normalized) return;
    if (index === 0) {
      result.extra = joinText(result.extra, normalized);
      return;
    }

    const section = detectLabeledSection(normalized);
    if (section.label === 'source') result.source = joinText(result.source, section.body);
    else result.extra = joinText(result.extra, section.body);
  });

  return result;
}

function splitStructuredChunks(raw: string) {
  return String(raw || '')
    .split(/<hr\b[^>]*>/gi)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectLabeledSection(value: string): { label: 'extra' | 'hint' | 'source' | null; body: string } {
  const normalized = String(value || '').trim();
  const patterns: Array<{ label: 'extra' | 'hint' | 'source'; pattern: RegExp }> = [
    { label: 'extra', pattern: /^(?:\*\*)?(?:extra|额外信息|详细信息)(?:\*\*)?:?\s*/i },
    { label: 'hint', pattern: /^(?:\*\*)?(?:hint|提示)(?:\*\*)?:?\s*/i },
    { label: 'source', pattern: /^(?:\*\*)?(?:source|来源)(?:\*\*)?:?\s*/i },
  ];

  for (const entry of patterns) {
    if (!entry.pattern.test(normalized)) continue;
    return {
      label: entry.label,
      body: normalized.replace(entry.pattern, '').trim(),
    };
  }

  return {
    label: null,
    body: normalized,
  };
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
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

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
  if (tag === 'audio') {
    const src = element.getAttribute('src') || '';
    return src ? `[sound:${src}]` : '';
  }
  if (tag === 'source') {
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

  if (note.type === 'note-only') {
    return [
      note.type,
      note.deckId,
      normalizeSignatureText(note.fields.title),
      normalizeSignatureText(note.fields.content),
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

function parseImportedTags(value: string) {
  return uniqueStrings(
    String(value || '')
      .split(/[\s,，\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
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

function readColumn(row: string[], index: number | null) {
  if (index === null || index < 0) return '';
  return String(row[index] || '');
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

function decodeImportedTextBytes(bytes: Uint8Array) {
  if (bytes.length === 0) return '';

  const bomEncoding = detectBomEncoding(bytes);
  if (bomEncoding) return stripBom(decodeWithEncoding(bytes, bomEncoding));

  const utf16Encoding = detectUtf16Encoding(bytes);
  if (utf16Encoding) return stripBom(decodeWithEncoding(bytes, utf16Encoding));

  try {
    return stripBom(decodeWithEncoding(bytes, 'utf-8', true));
  } catch {
    return stripBom(decodeWithEncoding(bytes, 'gb18030'));
  }
}

function decodeWithEncoding(bytes: Uint8Array, encoding: string, fatal = false) {
  return new TextDecoder(encoding, fatal ? { fatal: true } : undefined).decode(bytes);
}

function detectBomEncoding(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

function detectUtf16Encoding(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  let evenZeroCount = 0;
  let oddZeroCount = 0;
  let pairCount = 0;

  for (let index = 0; index + 1 < sample.length; index += 2) {
    pairCount += 1;
    if (sample[index] === 0) evenZeroCount += 1;
    if (sample[index + 1] === 0) oddZeroCount += 1;
  }

  if (pairCount < 2) return null;

  const threshold = Math.max(2, Math.floor(pairCount * 0.3));
  if (oddZeroCount >= threshold && oddZeroCount > evenZeroCount * 3) return 'utf-16le';
  if (evenZeroCount >= threshold && evenZeroCount > oddZeroCount * 3) return 'utf-16be';
  return null;
}
