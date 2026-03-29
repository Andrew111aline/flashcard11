import { useState } from 'react';
import { Edit2, Folder, MoreVertical, Plus, Trash2 } from 'lucide-react';
import { useDB, useTranslation } from '../lib/db';
import { uuid } from '../lib/fsrs';
import { getNoteSummary, getNoteTitle, noteProducesCards } from '../lib/notes';

export function Decks() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const lang = t('lang') as 'zh' | 'en';
  const isZh = lang === 'zh';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#0d9488');

  const openModal = (deckId?: string) => {
    if (deckId) {
      const deck = db.decks.find((item) => item.id === deckId);
      if (deck) {
        setName(deck.name);
        setDescription(deck.description);
        setColor(deck.color);
        setEditingDeck(deckId);
      }
    } else {
      setName('');
      setDescription('');
      setColor('#0d9488');
      setEditingDeck(null);
    }
    setIsModalOpen(true);
  };

  const saveDeck = () => {
    if (!name.trim()) return;
    setDB((prev) => editingDeck
      ? { ...prev, decks: prev.decks.map((deck) => (deck.id === editingDeck ? { ...deck, name, description, color } : deck)) }
      : { ...prev, decks: [...prev.decks, { id: uuid(), name, description, color, createdAt: new Date().toISOString() }] });
    setIsModalOpen(false);
  };

  const deleteDeck = (deckId: string) => {
    const deckCards = db.cards.filter((card) => card.deckId === deckId).map((card) => card.id);
    if (!window.confirm(t('decks_confirm_delete'))) return;
    setDB((prev) => ({
      ...prev,
      decks: prev.decks.filter((deck) => deck.id !== deckId),
      notes: prev.notes.filter((note) => note.deckId !== deckId),
      cards: prev.cards.filter((card) => card.deckId !== deckId),
      reviews: prev.reviews.filter((review) => !deckCards.includes(review.cardId)),
    }));
  };

  const deleteNote = (noteId: string) => {
    if (!window.confirm(isZh ? '删除这条笔记以及它派生出的复习卡？' : 'Delete this note and its derived review cards?')) return;
    const cardIds = db.cards.filter((card) => card.noteId === noteId).map((card) => card.id);
    setDB((prev) => ({
      ...prev,
      notes: prev.notes.filter((note) => note.id !== noteId),
      cards: prev.cards.filter((card) => card.noteId !== noteId),
      reviews: prev.reviews.filter((review) => !cardIds.includes(review.cardId)),
    }));
  };

  const now = new Date();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('nav_decks')}</h1>
          <p className="mt-1 text-sm text-slate-500">{isZh ? '每个卡组下面现在同时管理笔记和派生卡。' : 'Each deck now manages notes and the cards derived from them.'}</p>
        </div>
        <button onClick={() => openModal()} className="flex items-center gap-2 rounded-full bg-teal-600 px-4 py-2.5 font-medium text-white hover:bg-teal-700">
          <Plus className="h-5 w-5" />{t('decks_btn_new')}
        </button>
      </div>

      {db.decks.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white py-20 text-center">
          <Folder className="mx-auto mb-4 h-16 w-16 text-slate-300" />
          <h3 className="mb-2 text-lg font-medium text-slate-900">{t('decks_empty_title')}</h3>
          <p className="mb-6 text-slate-500">{t('decks_empty_desc')}</p>
          <button onClick={() => openModal()} className="rounded-full bg-teal-600 px-6 py-2.5 font-medium text-white hover:bg-teal-700">{t('decks_btn_new')}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {db.decks.map((deck) => {
            const notes = db.notes.filter((note) => note.deckId === deck.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            const cards = db.cards.filter((card) => card.deckId === deck.id);
            const due = cards.filter((card) => new Date(card.dueAt) <= now).length;
            const studyNotes = notes.filter((note) => noteProducesCards(note)).length;
            const recentNotes = notes.slice(0, 3);

            return (
              <section key={deck.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="h-2 w-full" style={{ backgroundColor: deck.color }} />
                <div className="p-5 sm:p-6">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{deck.name}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{deck.description || t('decks_no_desc')}</p>
                    </div>
                    <div className="group relative">
                      <button className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      <div className="absolute right-0 top-full z-10 mt-1 hidden w-36 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg group-hover:block">
                        <button onClick={() => openModal(deck.id)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"><Edit2 className="h-4 w-4" />{t('decks_btn_edit')}</button>
                        <button onClick={() => deleteDeck(deck.id)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{t('decks_btn_delete')}</button>
                      </div>
                    </div>
                  </div>

                  <div className="mb-6 grid grid-cols-3 gap-3">
                    <Metric label={isZh ? '笔记' : 'Notes'} value={notes.length} tone="slate" />
                    <Metric label={isZh ? '学习卡' : 'Cards'} value={cards.length} tone="teal" />
                    <Metric label={isZh ? '待复习' : 'Due'} value={due} tone={due > 0 ? 'amber' : 'slate'} />
                  </div>

                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{isZh ? '最近内容' : 'Recent Notes'}</h3>
                    <span className="text-xs text-slate-400">{isZh ? `${studyNotes} 条会生成复习卡` : `${studyNotes} produce review cards`}</span>
                  </div>

                  {recentNotes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                      {isZh ? '这个卡组里还没有内容，先加一条笔记。' : 'This deck is empty. Add your first note to get started.'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentNotes.map((note) => (
                        <div key={note.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">{getNoteTypeLabel(note.type, isZh)}</span>
                                {note.fields.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">#{tag}</span>)}
                              </div>
                              <h4 className="mt-2 font-semibold text-slate-900">{getNoteTitle(note)}</h4>
                              <p className="mt-1 text-sm leading-6 text-slate-500">{getNoteSummary(note) || (isZh ? '暂无补充说明。' : 'No extra summary yet.')}</p>
                            </div>
                            <div className="flex gap-2">
                              <a href={`#edit?deckId=${deck.id}&noteId=${note.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">{isZh ? '编辑' : 'Edit'}</a>
                              <button onClick={() => deleteNote(note.id)} className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50">{isZh ? '删除' : 'Delete'}</button>
                            </div>
                          </div>
                          {note.fields.source && <p className="text-xs text-slate-400">{isZh ? '来源：' : 'Source: '}{note.fields.source}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 border-t border-slate-100 bg-slate-50/80 p-4">
                  <a href={`#review?deckId=${deck.id}`} onClick={(event) => due === 0 && event.preventDefault()} className={`flex-1 rounded-full px-4 py-3 text-center font-medium ${due > 0 ? 'bg-teal-600 text-white hover:bg-teal-700' : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}>
                    {t('home_btn_review')}
                  </a>
                  <a href={`#edit?deckId=${deck.id}`} className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-center font-medium text-slate-700 hover:bg-slate-50">
                    {isZh ? '新增笔记' : 'Add Note'}
                  </a>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-xl">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-xl font-bold text-slate-900">{editingDeck ? t('decks_modal_edit') : t('decks_modal_new')}</h2>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t('decks_modal_name')}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" placeholder={t('decks_modal_name_ph')} autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t('decks_modal_desc')}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" placeholder={t('decks_modal_desc_ph')} rows={3} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">{t('decks_modal_color')}</label>
                <div className="flex flex-wrap gap-2">
                  {['#0d9488', '#0284c7', '#4f46e5', '#9333ea', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#475569'].map((item) => (
                    <button key={item} onClick={() => setColor(item)} className={`h-8 w-8 rounded-full ${color === item ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`} style={{ backgroundColor: item }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4">
              <button onClick={() => setIsModalOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200">{t('common_cancel')}</button>
              <button onClick={saveDeck} disabled={!name.trim()} className="rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{t('common_save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'teal' | 'amber' }) {
  const palette = {
    slate: 'bg-slate-100 text-slate-700',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
  }[tone];

  return (
    <div className={`rounded-2xl px-4 py-3 ${palette}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function getNoteTypeLabel(type: string, isZh: boolean) {
  if (type === 'basic') return isZh ? '基础' : 'Basic';
  if (type === 'basic-reversed') return isZh ? '双向' : 'Reversed';
  if (type === 'cloze') return 'Cloze';
  return isZh ? '笔记' : 'Note';
}
