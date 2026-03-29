import { useState, useEffect } from 'react';
import { useDB, useTranslation } from '../lib/db';
import { uuid } from '../lib/fsrs';
import { ArrowLeft, Save, Plus } from 'lucide-react';

export function CardEditor() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const [deckId, setDeckId] = useState<string>('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [cardId, setCardId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const dId = params.get('deckId');
    const cId = params.get('cardId');
    
    if (dId) setDeckId(dId);
    else if (db.decks.length > 0) setDeckId(db.decks[0].id);

    if (cId) {
      const card = db.cards.find(c => c.id === cId);
      if (card) {
        setCardId(cId);
        setDeckId(card.deckId);
        setFront(card.front);
        setBack(card.back);
        setTags(card.tags.join(', '));
      }
    }
  }, [db.decks, db.cards, window.location.hash]);

  const handleSave = (addAnother = false) => {
    if (!front.trim() || !back.trim() || !deckId) {
      alert(t('edit_alert_fill'));
      return;
    }

    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t);

    setDB(prev => {
      if (cardId) {
        return {
          ...prev,
          cards: prev.cards.map(c => 
            c.id === cardId ? { ...c, deckId, front, back, tags: tagArray } : c
          )
        };
      } else {
        const newCard = {
          id: uuid(),
          deckId,
          front,
          back,
          tags: tagArray,
          state: 'new' as const,
          stability: 0,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 0,
          lapses: 0,
          step: 0,
          dueAt: new Date().toISOString(),
          lastReview: null,
          createdAt: new Date().toISOString()
        };
        return {
          ...prev,
          cards: [...prev.cards, newCard]
        };
      }
    });

    if (addAnother) {
      setFront('');
      setBack('');
      setTags('');
      setCardId(null);
      // Keep deckId
    } else {
      window.location.hash = `#decks`;
    }
  };

  if (db.decks.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center mt-20">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('edit_empty_title')}</h2>
        <p className="text-gray-500 mb-8">{t('edit_empty_desc')}</p>
        <a 
          href="#decks"
          className="bg-teal-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          {t('nav_decks')}
        </a>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <a href="#decks" className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </a>
        <h1 className="text-3xl font-bold text-gray-900">
          {cardId ? t('edit_title_edit') : t('edit_title_add')}
        </h1>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('edit_select_deck')}</label>
          <select
            value={deckId}
            onChange={e => setDeckId(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-gray-900"
          >
            {db.decks.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="block text-sm font-bold text-gray-900">{t('edit_front')}</label>
              <span className="text-xs text-gray-400">{t('edit_chars', front.length)}</span>
            </div>
            <textarea
              value={front}
              onChange={e => setFront(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-y min-h-[120px] text-lg"
              placeholder={t('edit_front_ph')}
              autoFocus
            />
          </div>

          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="block text-sm font-bold text-gray-900">{t('edit_back')}</label>
              <span className="text-xs text-gray-400">{t('edit_chars', back.length)}</span>
            </div>
            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-y min-h-[160px] text-lg"
              placeholder={t('edit_back_ph')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('edit_tags')}</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder={t('edit_tags_ph')}
            />
            {tags && (
              <div className="flex flex-wrap gap-2 mt-3">
                {tags.split(',').map(t => t.trim()).filter(t => t).map((tag, i) => (
                  <span key={i} className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex flex-col sm:flex-row justify-end gap-3">
          <a
            href="#decks"
            className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors text-center"
          >
            {t('common_cancel')}
          </a>
          {!cardId && (
            <button
              onClick={() => handleSave(true)}
              className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium text-teal-700 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('edit_btn_save_add')}
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('edit_btn_save')}
          </button>
        </div>
      </div>
    </div>
  );
}
