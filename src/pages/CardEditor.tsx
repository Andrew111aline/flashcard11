import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { useDB, useTranslation } from '../lib/db';
import {
  buildCardRenderModel,
  checkCardQuality,
  createEmptyNote,
  extractClozeGroups,
  generateCardsFromNote,
  getNoteTitle,
  splitTags,
  stripMarkdown,
  summarizeQuality,
} from '../lib/notes';
import { uuid } from '../lib/fsrs';
import type { Note, NoteType } from '../types';

type VariantOption = { ordinal: number; label: string };

export function CardEditor() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const lang = t('lang') as 'zh' | 'en';
  const isZh = lang === 'zh';
  const [routeHash, setRouteHash] = useState(window.location.hash || '#edit');
  const [note, setNote] = useState<Note>(() => createEmptyNote(''));
  const [tagInput, setTagInput] = useState('');
  const [previewOrdinal, setPreviewOrdinal] = useState(0);
  const [previewBack, setPreviewBack] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash || '#edit');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(routeHash.split('?')[1] || '');
    const deckId = params.get('deckId') || db.decks[0]?.id || '';
    const noteId = params.get('noteId');
    const existing = noteId ? db.notes.find((item) => item.id === noteId) : null;
    const initial = existing ? cloneNote(existing) : createEmptyNote(deckId);
    if (!existing) initial.deckId = deckId;
    setNote(initial);
    setTagInput(initial.fields.tags.join(', '));
    setPreviewOrdinal(0);
    setPreviewBack(false);
    setShowHint(false);
  }, [routeHash, db.decks, db.notes]);

  const quality = useMemo(() => checkCardQuality(note, lang), [note, lang]);
  const variants = useMemo(() => getVariantOptions(note, isZh), [note, isZh]);
  const preview = useMemo(() => buildCardRenderModel(note, previewOrdinal), [note, previewOrdinal]);
  const clozeGroups = useMemo(() => extractClozeGroups(note.clozeSrc), [note.clozeSrc]);

  useEffect(() => {
    if (previewOrdinal > Math.max(variants.length - 1, 0)) setPreviewOrdinal(0);
  }, [previewOrdinal, variants.length]);

  const typeOptions = [
    { value: 'basic' as const, icon: 'Q/A', label: isZh ? '基础' : 'Basic', desc: isZh ? '一问一答。' : 'Single prompt and answer.' },
    { value: 'basic-reversed' as const, icon: 'A↔B', label: isZh ? '双向' : 'Reversed', desc: isZh ? '自动生成正反两张卡。' : 'Create forward and reverse cards.' },
    { value: 'cloze' as const, icon: '[ ]', label: isZh ? '填空' : 'Cloze', desc: isZh ? '在语境里做遮挡。' : 'Hide parts inside context.' },
    { value: 'note-only' as const, icon: 'NOTE', label: isZh ? '笔记' : 'Note', desc: isZh ? '只存知识，不参与复习。' : 'Store context without review cards.' },
  ];

  const updateNote = (updater: (current: Note) => Note) => setNote((current) => updater(current));
  const updateField = (key: keyof Note['fields'], value: string | string[]) =>
    updateNote((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));

  const saveNote = (addAnother = false) => {
    const error = validateNote(note, quality, isZh);
    if (error) return window.alert(error);

    const now = new Date().toISOString();
    const noteId = note.id || uuid();
    const prepared: Note = {
      ...note,
      id: noteId,
      createdAt: note.createdAt || now,
      updatedAt: now,
      fields: { ...note.fields, tags: splitTags(note.fields.tags) },
      quality: summarizeQuality({ ...note, id: noteId, createdAt: note.createdAt || now, updatedAt: now }, lang),
    };

    setDB((prev) => {
      const existingCards = prev.cards.filter((card) => card.noteId === noteId);
      const nextCards = generateCardsFromNote(prepared, existingCards);
      const nextCardIds = new Set(nextCards.map((card) => card.id));
      const removed = existingCards.filter((card) => !nextCardIds.has(card.id)).map((card) => card.id);
      return {
        ...prev,
        notes: prev.notes.some((item) => item.id === noteId)
          ? prev.notes.map((item) => (item.id === noteId ? prepared : item))
          : [...prev.notes, prepared],
        cards: [...prev.cards.filter((card) => card.noteId !== noteId), ...nextCards],
        reviews: removed.length ? prev.reviews.filter((review) => !removed.includes(review.cardId)) : prev.reviews,
      };
    });

    if (addAnother) {
      const empty = createEmptyNote(prepared.deckId);
      setNote(empty);
      setTagInput('');
      setPreviewOrdinal(0);
      setPreviewBack(false);
      setShowHint(false);
      window.location.hash = `#edit?deckId=${prepared.deckId}`;
      return;
    }

    window.location.hash = '#decks';
  };

  if (db.decks.length === 0) {
    return (
      <div className="mx-auto mt-20 max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h2 className="mb-3 text-2xl font-bold text-slate-900">{t('edit_empty_title')}</h2>
        <p className="mb-8 text-slate-500">{t('edit_empty_desc')}</p>
        <a href="#decks" className="inline-flex rounded-full bg-teal-600 px-5 py-3 font-medium text-white hover:bg-teal-700">{t('nav_decks')}</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-8 flex items-center gap-4">
        <a href="#decks" className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-5 w-5" />
        </a>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{note.id ? (isZh ? '编辑笔记' : 'Edit Note') : (isZh ? '新建笔记' : 'New Note')}</h1>
          <p className="mt-1 text-sm text-slate-500">{isZh ? '按 Note → Cards 的结构制卡。' : 'Create notes first, then derive cards.'}</p>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/80 p-6">
            <label className="mb-2 block text-sm font-semibold text-slate-700">{t('edit_select_deck')}</label>
            <select value={note.deckId} onChange={(e) => updateNote((current) => ({ ...current, deckId: e.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100">
              {db.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
            </select>
          </div>
          <div className="space-y-8 p-6">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">{isZh ? '卡片类型' : 'Note Type'}</h2>
                <span className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Note → Cards</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {typeOptions.map((option) => {
                  const active = note.type === option.value;
                  return (
                    <button key={option.value} type="button" onClick={() => { updateNote((current) => migrateNoteType(current, option.value)); setPreviewOrdinal(0); setPreviewBack(false); setShowHint(false); }} className={`rounded-3xl border px-4 py-4 text-left ${active ? 'border-teal-300 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-semibold tracking-[0.24em] text-slate-500">{option.icon}</span>
                        {active && <span className="rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white">{isZh ? '当前' : 'Active'}</span>}
                      </div>
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{option.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            {renderEditorFields({ note, isZh, tagInput, setTagInput, updateField, updateNote, clozeGroups })}
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 p-6 sm:flex-row sm:justify-end">
            <a href="#decks" className="rounded-full px-5 py-3 text-center font-medium text-slate-600 hover:bg-slate-200">{t('common_cancel')}</a>
            <button type="button" onClick={() => saveNote(true)} className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-100 px-5 py-3 font-medium text-amber-900 hover:bg-amber-200">
              <Plus className="h-4 w-4" />{isZh ? '保存并继续' : 'Save & Continue'}
            </button>
            <button type="button" onClick={() => saveNote(false)} className="inline-flex items-center justify-center gap-2 rounded-full bg-teal-600 px-5 py-3 font-medium text-white hover:bg-teal-700">
              <Save className="h-4 w-4" />{isZh ? '保存笔记' : 'Save Note'}
            </button>
          </div>
        </section>
        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <PreviewPanel isZh={isZh} note={note} variants={variants} previewOrdinal={previewOrdinal} previewBack={previewBack} preview={preview} showHint={showHint} setPreviewOrdinal={setPreviewOrdinal} setPreviewBack={setPreviewBack} setShowHint={setShowHint} />
          <QualityPanel isZh={isZh} quality={quality} />
        </aside>
      </div>
    </div>
  );
}

function renderEditorFields({
  note, isZh, tagInput, setTagInput, updateField, updateNote, clozeGroups,
}: {
  note: Note;
  isZh: boolean;
  tagInput: string;
  setTagInput: (value: string) => void;
  updateField: (key: keyof Note['fields'], value: string | string[]) => void;
  updateNote: (updater: (current: Note) => Note) => void;
  clozeGroups: string[];
}) {
  const tagField = (
    <FieldShell label={isZh ? '标签' : 'Tags'}>
      <input value={tagInput} onChange={(e) => { setTagInput(e.target.value); updateField('tags', splitTags(e.target.value)); }} className="editor-input" placeholder={isZh ? '例如：四级, 动词, 核心词汇' : 'e.g. cet4, verb, core'} />
    </FieldShell>
  );

  if (note.type === 'cloze') {
    return (
      <>
        <FieldShell label={isZh ? '填空文本' : 'Cloze Text'} hint={isZh ? '语法：{{c1::答案}} 或 {{c1::答案::提示}}' : 'Syntax: {{c1::answer}} or {{c1::answer::hint}}'} meta={clozeGroups.length ? (isZh ? `检测到 ${clozeGroups.length} 组：${clozeGroups.map((g) => `c${g}`).join(', ')}` : `${clozeGroups.length} group(s): ${clozeGroups.map((g) => `c${g}`).join(', ')}`) : (isZh ? '还没有检测到有效填空' : 'No valid cloze groups detected')}>
          <textarea value={note.clozeSrc} onChange={(e) => updateNote((current) => ({ ...current, clozeSrc: e.target.value }))} className="editor-textarea" rows={7} placeholder={isZh ? '例如：光合作用将 {{c1::光能}} 转化为 {{c2::化学能}}。' : 'e.g. Photosynthesis converts {{c1::light energy}} into {{c2::chemical energy}}.'} autoFocus />
        </FieldShell>
        <div className="grid gap-5 lg:grid-cols-2">
          <FieldShell label={isZh ? '来源 / 语境' : 'Source / Context'}><input value={note.fields.source} onChange={(e) => updateField('source', e.target.value)} className="editor-input" placeholder={isZh ? '例如：生物必修二，第 17 页' : 'e.g. Biology textbook p.17'} /></FieldShell>
          {tagField}
        </div>
        <FieldShell label={isZh ? '额外信息' : 'Extra'} hint={isZh ? '翻面后显示，不参与测试。支持 Markdown、图片 `![alt](url)` 和音频 `[sound:url]`。' : 'Shown after reveal, not directly tested. Supports Markdown, images `![alt](url)`, and audio `[sound:url]`.'}>
          <textarea value={note.fields.extra} onChange={(e) => updateField('extra', e.target.value)} className="editor-textarea" rows={5} placeholder={isZh ? '补充解释、例句、误区提醒等。' : 'Add explanation, examples, or pitfalls here.'} />
        </FieldShell>
      </>
    );
  }

  if (note.type === 'note-only') {
    return (
      <>
        <FieldShell label={isZh ? '标题' : 'Title'}><input value={note.fields.title} onChange={(e) => updateField('title', e.target.value)} className="editor-input" placeholder={isZh ? '例如：光合作用总览' : 'e.g. Photosynthesis overview'} autoFocus /></FieldShell>
        <FieldShell label={isZh ? '笔记内容' : 'Note Body'} hint={isZh ? '支持 Markdown、图片 `![alt](url)` 和音频 `[sound:url]`。' : 'Supports Markdown, images `![alt](url)`, and audio `[sound:url]`.'}><textarea value={note.fields.content} onChange={(e) => updateField('content', e.target.value)} className="editor-textarea" rows={9} placeholder={isZh ? '把暂时不适合直接测试的背景知识放在这里。' : 'Keep background knowledge here until it is ready for cards.'} /></FieldShell>
        <div className="grid gap-5 lg:grid-cols-2">
          <FieldShell label={isZh ? '来源 / 语境' : 'Source / Context'}><input value={note.fields.source} onChange={(e) => updateField('source', e.target.value)} className="editor-input" placeholder={isZh ? '例如：老师讲义，第 5 页' : 'e.g. lecture handout p.5'} /></FieldShell>
          {tagField}
        </div>
      </>
    );
  }

  return (
    <>
      <FieldShell label={isZh ? '正面' : 'Front'} meta={isZh ? `${note.fields.front.length} 字符` : `${note.fields.front.length} chars`}>
        <textarea value={note.fields.front} onChange={(e) => updateField('front', e.target.value)} className="editor-textarea" rows={5} placeholder={isZh ? '问题尽量具体，例如：在神经元中，髓鞘的作用是什么？' : 'Keep it precise, e.g. What does myelin do in a neuron?'} autoFocus />
      </FieldShell>
      <FieldShell label={isZh ? '背面' : 'Back'} meta={isZh ? `${note.fields.back.length} 字符` : `${note.fields.back.length} chars`}>
        <textarea value={note.fields.back} onChange={(e) => updateField('back', e.target.value)} className="editor-textarea" rows={6} placeholder={isZh ? '写出最小必要答案，把细节放到额外信息。' : 'Write the minimum answer here and push details to Extra.'} />
      </FieldShell>
      <div className="grid gap-5 lg:grid-cols-2">
        <FieldShell label={isZh ? '提示' : 'Hint'}><input value={note.fields.hint} onChange={(e) => updateField('hint', e.target.value)} className="editor-input" placeholder={isZh ? '可选：给自己一个渐进提示' : 'Optional progressive hint'} /></FieldShell>
        <FieldShell label={isZh ? '来源 / 语境' : 'Source / Context'}><input value={note.fields.source} onChange={(e) => updateField('source', e.target.value)} className="editor-input" placeholder={isZh ? '例如：精读第 3 章 p.47' : 'e.g. deep reading ch.3 p.47'} /></FieldShell>
      </div>
      <FieldShell label={isZh ? '额外信息' : 'Extra'} hint={isZh ? '翻面后展开显示，不参与测试。支持 Markdown、图片 `![alt](url)` 和音频 `[sound:url]`。' : 'Shown after reveal, but not directly tested. Supports Markdown, images `![alt](url)`, and audio `[sound:url]`.'}>
        <textarea value={note.fields.extra} onChange={(e) => updateField('extra', e.target.value)} className="editor-textarea" rows={5} placeholder={isZh ? '补充例句、误区、推导过程等。' : 'Add examples, pitfalls, or derivations here.'} />
      </FieldShell>
      {tagField}
      {!!note.fields.tags.length && <div className="flex flex-wrap gap-2">{note.fields.tags.map((tag) => <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">#{tag}</span>)}</div>}
    </>
  );
}

function PreviewPanel({
  isZh, note, variants, previewOrdinal, previewBack, preview, showHint, setPreviewOrdinal, setPreviewBack, setShowHint,
}: {
  isZh: boolean;
  note: Note;
  variants: VariantOption[];
  previewOrdinal: number;
  previewBack: boolean;
  preview: ReturnType<typeof buildCardRenderModel>;
  showHint: boolean;
  setPreviewOrdinal: (value: number) => void;
  setPreviewBack: (value: boolean | ((current: boolean) => boolean)) => void;
  setShowHint: (value: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/80 p-5">
        <h2 className="text-lg font-bold text-slate-900">{isZh ? '实时预览' : 'Live Preview'}</h2>
        <p className="mt-1 text-sm text-slate-500">{note.type === 'note-only' ? (isZh ? '这是一条知识笔记，不会生成复习卡。' : 'This is a reference note and will not create review cards.') : (isZh ? '查看派生卡片的正面和背面。' : 'Inspect the front and back of derived cards.')}</p>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">{variants.map((variant) => <button key={variant.ordinal} type="button" onClick={() => { setPreviewOrdinal(variant.ordinal); setPreviewBack(false); setShowHint(false); }} className={`rounded-full px-3 py-1.5 text-sm font-medium ${previewOrdinal === variant.ordinal ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{variant.label}</button>)}</div>
        <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef6f4_100%)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold tracking-[0.22em] text-slate-500">{previewBack ? (isZh ? '答案面' : 'Back') : (isZh ? '问题面' : 'Front')}</span>
            <button type="button" onClick={() => { setPreviewBack((value) => !value); setShowHint(false); }} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">{previewBack ? (isZh ? '看正面' : 'Show Front') : (isZh ? '翻到背面' : 'Flip')}</button>
          </div>
          {!previewBack && <div className="note-content min-h-[180px] text-slate-900" dangerouslySetInnerHTML={{ __html: preview.frontHtml }} />}
          {previewBack && (
            <div className="space-y-4">
              {preview.backContextHtml && note.type !== 'note-only' && <div className="rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-500"><div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{isZh ? '问题' : 'Prompt'}</div><div className="note-content" dangerouslySetInnerHTML={{ __html: preview.backContextHtml }} /></div>}
              <div className="note-content min-h-[140px] text-slate-900" dangerouslySetInnerHTML={{ __html: preview.backHtml }} />
              {preview.extraHtml && <details className="rounded-2xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-600"><summary className="cursor-pointer list-none font-semibold text-slate-700">{isZh ? '详细信息' : 'Extra Details'}</summary><div className="note-content mt-3" dangerouslySetInnerHTML={{ __html: preview.extraHtml }} /></details>}
              {preview.source && <div className="rounded-2xl bg-white/80 px-3 py-2 text-sm text-slate-500"><span className="font-semibold text-slate-700">{isZh ? '来源：' : 'Source: '}</span>{preview.source}</div>}
            </div>
          )}
          {!previewBack && preview.hint && note.type !== 'cloze' && <div className="mt-4 rounded-2xl border border-dashed border-teal-300 bg-white/80 p-3"><button type="button" onClick={() => setShowHint((value) => !value)} className="text-sm font-semibold text-teal-700">{showHint ? (isZh ? '隐藏提示' : 'Hide Hint') : (isZh ? '显示提示' : 'Show Hint')}</button>{showHint && <p className="mt-2 text-sm leading-6 text-slate-600">{preview.hint}</p>}</div>}
        </div>
      </div>
    </section>
  );
}

function QualityPanel({ isZh, quality }: { isZh: boolean; quality: ReturnType<typeof checkCardQuality> }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/80 p-5">
        <div className="flex items-end justify-between gap-4">
          <div><h2 className="text-lg font-bold text-slate-900">{isZh ? '制卡质量' : 'Card Quality'}</h2><p className="mt-1 text-sm text-slate-500">{isZh ? '根据最小信息、上下文和 Cloze 原则给出建议。' : 'Live checks inspired by atomic cards, context, and cloze-first design.'}</p></div>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${scoreToneClass(quality.score)}`}>{quality.score}/100</span>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {quality.issues.length === 0 ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{isZh ? '这张卡目前很干净，可以继续保持原子化和语境信息。' : 'This note looks clean. Keep the prompt atomic and the context meaningful.'}</div> : <ul className="space-y-3">{quality.issues.map((issue) => <li key={issue.id} className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${issueToneClass(issue.severity)}`}><div className="mb-1 text-xs font-bold uppercase tracking-[0.2em]">{issue.severity}</div><div>{issue.message}</div></li>)}</ul>}
        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <summary className="cursor-pointer list-none font-semibold text-slate-800">{isZh ? '制卡原则速查' : 'Quick Principles'}</summary>
          <ul className="mt-3 space-y-2 leading-6">
            <li>{isZh ? '一卡一知识点，不把多个问题塞进同一张卡。' : 'One card, one idea.'}</li>
            <li>{isZh ? '尽量给问题加入语境，而不是孤立记忆。' : 'Prefer context-rich prompts over isolated facts.'}</li>
            <li>{isZh ? '能用 Cloze 的地方，让句子自己说话。' : 'Use cloze when the sentence itself can teach.'}</li>
            <li>{isZh ? '解释、例句和来源放在额外信息里。' : 'Put explanations, examples, and sources in Extra.'}</li>
            <li>{isZh ? '还没理解透的内容，先记成 Note。' : 'If you do not understand it yet, keep it as a note first.'}</li>
          </ul>
        </details>
      </div>
    </section>
  );
}

function FieldShell({ label, children, hint, meta }: { label: string; children: ReactNode; hint?: string; meta?: string }) {
  return <div><div className="mb-2 flex items-end justify-between gap-4"><label className="text-sm font-semibold text-slate-800">{label}</label>{meta && <span className="text-xs font-medium text-slate-400">{meta}</span>}</div>{children}{hint && <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>}</div>;
}

function cloneNote(note: Note): Note {
  return { ...note, fields: { ...note.fields, tags: [...note.fields.tags] }, quality: { score: note.quality.score, issues: [...note.quality.issues] } };
}

function getVariantOptions(note: Note, isZh: boolean): VariantOption[] {
  if (note.type === 'basic') return [{ ordinal: 0, label: isZh ? '正向' : 'Forward' }];
  if (note.type === 'basic-reversed') return [{ ordinal: 0, label: isZh ? '正向' : 'Forward' }, { ordinal: 1, label: isZh ? '反向' : 'Reverse' }];
  if (note.type === 'cloze') {
    const groups = extractClozeGroups(note.clozeSrc);
    return groups.length ? groups.map((groupId, index) => ({ ordinal: index, label: `c${groupId}` })) : [{ ordinal: 0, label: isZh ? '填空' : 'Cloze' }];
  }
  return [{ ordinal: 0, label: isZh ? '笔记' : 'Note' }];
}

function validateNote(note: Note, quality: ReturnType<typeof checkCardQuality>, isZh: boolean) {
  if (!note.deckId) return isZh ? '请先选择一个卡组。' : 'Please select a deck first.';
  if (note.type === 'note-only') return !note.fields.title.trim() && !note.fields.content.trim() ? (isZh ? '请至少填写标题或笔记内容。' : 'Please add at least a title or note body.') : null;
  if (note.type === 'cloze') {
    if (!note.clozeSrc.trim()) return isZh ? '请填写 Cloze 文本。' : 'Please add cloze text.';
    if (extractClozeGroups(note.clozeSrc).length === 0) return isZh ? '请至少写一个有效的 {{c1::答案}} 填空。' : 'Please add at least one valid {{c1::answer}} deletion.';
  } else if (!note.fields.front.trim() || !note.fields.back.trim()) {
    return isZh ? '请先填写正面和背面。' : 'Please fill in both front and back.';
  }
  return quality.issues.some((issue) => issue.severity === 'error') ? (isZh ? '还有需要修正的错误，请处理后再保存。' : 'Please fix the blocking issues before saving.') : null;
}

function migrateNoteType(note: Note, nextType: NoteType): Note {
  const next = cloneNote(note);
  next.type = nextType;
  if (nextType === 'note-only') {
    if (!next.fields.title.trim()) next.fields.title = stripMarkdown(note.fields.front || note.clozeSrc || getNoteTitle(note));
    if (!next.fields.content.trim()) next.fields.content = note.fields.back || note.fields.extra || note.clozeSrc;
  }
  if (note.type === 'note-only' && nextType !== 'note-only') {
    if (!next.fields.front.trim()) next.fields.front = note.fields.title;
    if (!next.fields.back.trim()) next.fields.back = note.fields.content;
  }
  if (nextType === 'cloze' && !next.clozeSrc.trim()) next.clozeSrc = note.fields.front || note.fields.back || '';
  return next;
}

function scoreToneClass(score: number) {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700';
  if (score >= 60) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

function issueToneClass(severity: 'error' | 'warning' | 'info') {
  if (severity === 'error') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}
