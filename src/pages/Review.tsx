import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useDB, useTranslation } from '../lib/db';
import { FSRS } from '../lib/fsrs';
import { buildCardRenderModel, extractClozeGroups, getNoteTitle } from '../lib/notes';
import type { Card, Note } from '../types';

const PRIORITY = { relearning: 1, learning: 2, review: 3, new: 4 };

export function Review() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const lang = t('lang') as 'zh' | 'en';
  const isZh = lang === 'zh';
  const [routeHash, setRouteHash] = useState(window.location.hash || '#review');
  const [queue, setQueue] = useState<Card[]>([]);
  const [current, setCurrent] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, total: 0 });
  const pendingRequeueTimersRef = useRef<number[]>([]);

  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash || '#review');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const deckId = useMemo(() => new URLSearchParams(routeHash.split('?')[1] || '').get('deckId'), [routeHash]);
  const deck = useMemo(() => db.decks.find((item) => item.id === deckId), [db.decks, deckId]);
  const fsrs = useMemo(() => new FSRS(db.settings), [db.settings]);
  const clearPendingRequeues = useCallback(() => {
    pendingRequeueTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    pendingRequeueTimersRef.current = [];
  }, []);

  useEffect(() => {
    clearPendingRequeues();
    if (!deckId) return;
    const now = new Date();
    const due = db.cards
      .filter((card) => card.deckId === deckId && new Date(card.dueAt) <= now && db.notes.some((note) => note.id === card.noteId))
      .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state]);
    setQueue(due);
    setCurrent(0);
    setIsFlipped(false);
    setShowHint(false);
    setSessionStats({ reviewed: 0, total: due.length });
    return clearPendingRequeues;
  }, [clearPendingRequeues, deckId]);

  const scheduleRequeue = useCallback((card: Card, now: Date) => {
    if (card.state !== 'learning' && card.state !== 'relearning') return;

    const delayMs = new Date(card.dueAt).getTime() - now.getTime();
    const enqueue = () => {
      setQueue((prev) => [...prev, card]);
      setSessionStats((prev) => ({ ...prev, total: prev.total + 1 }));
    };

    if (delayMs <= 0) {
      enqueue();
      return;
    }

    const timerId = window.setTimeout(() => {
      pendingRequeueTimersRef.current = pendingRequeueTimersRef.current.filter((id) => id !== timerId);
      enqueue();
    }, delayMs);

    pendingRequeueTimersRef.current.push(timerId);
  }, []);

  const currentCard = queue[current];
  const currentNote = useMemo(
    () => (currentCard ? db.notes.find((note) => note.id === currentCard.noteId) || null : null),
    [db.notes, currentCard],
  );
  const renderModel = useMemo(
    () => (currentNote && currentCard ? buildCardRenderModel(currentNote, currentCard.ordinal) : null),
    [currentNote, currentCard],
  );
  const previews = useMemo(
    () => (currentCard ? fsrs.previewSchedule(currentCard, new Date(), lang) : null),
    [currentCard, fsrs, lang],
  );

  const handleRate = useCallback((rating: number) => {
    if (!currentCard) return;
    const now = new Date();
    const updatedCard = fsrs.schedule(currentCard, rating, now);

    setDB((prev) => ({
      ...prev,
      cards: prev.cards.map((card) => (card.id === updatedCard.id ? updatedCard : card)),
      reviews: [
        ...prev.reviews,
        {
          cardId: currentCard.id,
          rating,
          state: currentCard.state,
          scheduledDays: updatedCard.scheduledDays,
          reviewedAt: now.toISOString(),
        },
      ],
    }));

    scheduleRequeue(updatedCard, now);
    setSessionStats((prev) => ({ ...prev, reviewed: prev.reviewed + 1 }));
    setCurrent((prev) => prev + 1);
    setIsFlipped(false);
    setShowHint(false);
  }, [currentCard, fsrs, scheduleRequeue, setDB]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!currentCard) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setIsFlipped(true);
        return;
      }
      if (!isFlipped) return;
      if (event.key === '1') handleRate(1);
      if (event.key === '2') handleRate(2);
      if (event.key === '3') handleRate(3);
      if (event.key === '4') handleRate(4);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentCard, handleRate, isFlipped]);

  if (!deckId) {
    return (
      <div className="p-6 text-center">
        <p>{t('review_no_deck')}</p>
        <a href="#decks" className="text-teal-600 hover:underline">{t('nav_decks')}</a>
      </div>
    );
  }

  if (!currentCard || current >= queue.length || !currentNote || !renderModel) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-teal-50 text-teal-500">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-slate-900">{t('review_complete_title')}</h2>
          <p className="mb-8 text-slate-500">{t('review_complete_desc', sessionStats.reviewed)}</p>
          <a href="#home" className="block w-full rounded-2xl bg-teal-600 py-3 font-medium text-white hover:bg-teal-700">{t('nav_home')}</a>
        </div>
      </div>
    );
  }

  const progress = sessionStats.total > 0 ? (sessionStats.reviewed / sessionStats.total) * 100 : 0;
  const badge = getBadgeLabel(currentNote, currentCard, isZh);

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a href="#decks" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              <ArrowLeft className="h-5 w-5" />
            </a>
            <div>
              <h1 className="font-bold text-slate-900">{deck?.name}</h1>
              <p className="text-xs text-slate-500">{getNoteTitle(currentNote)}</p>
            </div>
          </div>
          <div className="text-sm font-medium text-slate-500">{sessionStats.reviewed} / {sessionStats.total}</div>
        </div>
      </header>
      <div className="h-1 w-full bg-slate-200"><div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${progress}%` }} /></div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center">
          <section className="w-full max-w-3xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold tracking-[0.2em] text-white">{badge}</span>
                {currentNote.fields.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">#{tag}</span>
                ))}
              </div>
              {currentNote.type === 'basic-reversed' && currentCard.ordinal === 1 && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{isZh ? '反向检索' : 'Reverse Recall'}</span>
              )}
            </div>

            {!isFlipped && (
              <>
                <div className="note-content min-h-[260px] text-xl text-slate-900 sm:text-2xl" dangerouslySetInnerHTML={{ __html: renderModel.frontHtml }} />
                {renderModel.hint && currentNote.type !== 'cloze' && (
                  <div className="mt-5 rounded-2xl border border-dashed border-teal-300 bg-teal-50/60 p-4">
                    <button type="button" onClick={() => setShowHint((value) => !value)} className="text-sm font-semibold text-teal-700">
                      {showHint ? (isZh ? '隐藏提示' : 'Hide Hint') : (isZh ? '显示提示' : 'Show Hint')}
                    </button>
                    {showHint && <p className="mt-2 text-sm leading-6 text-slate-600">{renderModel.hint}</p>}
                  </div>
                )}
                <button type="button" onClick={() => setIsFlipped(true)} className="mt-6 w-full rounded-2xl bg-slate-900 px-5 py-3 font-medium text-white hover:bg-slate-800">
                  {t('review_show_answer')}
                </button>
              </>
            )}

            {isFlipped && (
              <div className="space-y-5">
                {renderModel.backContextHtml && currentNote.type !== 'note-only' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{isZh ? '问题' : 'Prompt'}</div>
                    <div className="note-content text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: renderModel.backContextHtml }} />
                  </div>
                )}
                <div className="note-content min-h-[200px] text-slate-900" dangerouslySetInnerHTML={{ __html: renderModel.backHtml }} />
                {renderModel.extraHtml && (
                  <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <summary className="cursor-pointer list-none font-semibold text-slate-800">{isZh ? '详细信息' : 'Extra Details'}</summary>
                    <div className="note-content mt-3" dangerouslySetInnerHTML={{ __html: renderModel.extraHtml }} />
                  </details>
                )}
                {renderModel.source && (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    <span className="font-semibold text-slate-700">{isZh ? '来源：' : 'Source: '}</span>{renderModel.source}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className={`mt-8 w-full max-w-3xl transition-opacity ${isFlipped ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <RateButton color="rose" label={t('review_btn_again')} hint={previews?.[1]} hotkey="1" onClick={() => handleRate(1)} />
              <RateButton color="amber" label={t('review_btn_hard')} hint={previews?.[2]} hotkey="2" onClick={() => handleRate(2)} />
              <RateButton color="emerald" label={t('review_btn_good')} hint={previews?.[3]} hotkey="3" onClick={() => handleRate(3)} />
              <RateButton color="sky" label={t('review_btn_easy')} hint={previews?.[4]} hotkey="4" onClick={() => handleRate(4)} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function RateButton({
  color, label, hint, hotkey, onClick,
}: {
  color: 'rose' | 'amber' | 'emerald' | 'sky';
  label: string;
  hint?: string;
  hotkey: string;
  onClick: () => void;
}) {
  const tone = {
    rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
  }[color];

  return (
    <button type="button" onClick={onClick} className={`rounded-3xl border px-4 py-4 text-center transition ${tone}`}>
      <div className="font-bold">{label}</div>
      <div className="mt-1 text-sm opacity-80">{hint || '--'}</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.22em] opacity-60">Press {hotkey}</div>
    </button>
  );
}

function getBadgeLabel(note: Note, card: Card, isZh: boolean) {
  if (note.type === 'basic') return isZh ? '基础卡' : 'Basic';
  if (note.type === 'basic-reversed') return card.ordinal === 1 ? (isZh ? '双向卡 · 反向' : 'Reversed · Reverse') : (isZh ? '双向卡 · 正向' : 'Reversed · Forward');
  if (note.type === 'cloze') return `Cloze c${extractClozeGroups(note.clozeSrc)[card.ordinal] || card.ordinal + 1}`;
  return isZh ? '笔记' : 'Note';
}
