import { useState } from 'react';
import { useDB, useTranslation } from '../lib/db';
import { uuid } from '../lib/fsrs';
import { Plus, MoreVertical, Edit2, Trash2, Folder } from 'lucide-react';

export function Decks() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#0d9488');

  const openModal = (deckId?: string) => {
    if (deckId) {
      const deck = db.decks.find(d => d.id === deckId);
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
    
    setDB(prev => {
      if (editingDeck) {
        return {
          ...prev,
          decks: prev.decks.map(d => 
            d.id === editingDeck ? { ...d, name, description, color } : d
          )
        };
      } else {
        return {
          ...prev,
          decks: [
            ...prev.decks,
            {
              id: uuid(),
              name,
              description,
              color,
              createdAt: new Date().toISOString()
            }
          ]
        };
      }
    });
    setIsModalOpen(false);
  };

  const deleteDeck = (id: string) => {
    if (confirm(t('decks_confirm_delete'))) {
      setDB(prev => ({
        ...prev,
        decks: prev.decks.filter(d => d.id !== id),
        cards: prev.cards.filter(c => c.deckId !== id)
      }));
    }
  };

  const now = new Date();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{t('nav_decks')}</h1>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md font-medium hover:bg-teal-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {t('decks_btn_new')}
        </button>
      </div>

      {db.decks.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200 border-dashed">
          <Folder className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('decks_empty_title')}</h3>
          <p className="text-gray-500 mb-6">{t('decks_empty_desc')}</p>
          <button
            onClick={() => openModal()}
            className="bg-teal-600 text-white px-6 py-2 rounded-md font-medium hover:bg-teal-700 transition-colors"
          >
            {t('decks_btn_new')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {db.decks.map(deck => {
            const cards = db.cards.filter(c => c.deckId === deck.id);
            const due = cards.filter(c => new Date(c.dueAt) <= now).length;
            
            return (
              <div key={deck.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                <div className="h-2 w-full" style={{ backgroundColor: deck.color }} />
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-gray-900 text-xl truncate pr-4" title={deck.name}>
                      {deck.name}
                    </h3>
                    <div className="relative group">
                      <button className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-md shadow-lg border border-gray-100 py-1 hidden group-hover:block z-10">
                        <button 
                          onClick={() => openModal(deck.id)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Edit2 className="w-4 h-4" /> {t('decks_btn_edit')}
                        </button>
                        <button 
                          onClick={() => deleteDeck(deck.id)}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" /> {t('decks_btn_delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <p className="text-gray-500 text-sm mb-6 flex-1 line-clamp-2">
                    {deck.description || t('decks_no_desc')}
                  </p>
                  
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">{t('decks_card_count', cards.length)}</span>
                    {due > 0 ? (
                      <span className="bg-teal-50 text-teal-700 font-bold px-2 py-1 rounded-full">
                        {t('decks_due_count', due)}
                      </span>
                    ) : (
                      <span className="text-gray-400">{t('decks_due_count', 0)}</span>
                    )}
                  </div>
                </div>
                <div className="border-t border-gray-100 bg-gray-50 p-3 flex gap-2">
                  <a 
                    href={`#review?deckId=${deck.id}`}
                    className={`flex-1 text-center py-2 rounded-md font-medium text-sm transition-colors ${
                      due > 0 
                        ? 'bg-teal-600 text-white hover:bg-teal-700' 
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                    onClick={(e) => due === 0 && e.preventDefault()}
                  >
                    {t('home_btn_review')}
                  </a>
                  <a 
                    href={`#edit?deckId=${deck.id}`}
                    className="flex-1 text-center py-2 rounded-md font-medium text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {t('deck_add_card')}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingDeck ? t('decks_modal_edit') : t('decks_modal_new')}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('decks_modal_name')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder={t('decks_modal_name_ph')}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('decks_modal_desc')}</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder={t('decks_modal_desc_ph')}
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('decks_modal_color')}</label>
                <div className="flex gap-2">
                  {['#0d9488', '#0284c7', '#4f46e5', '#9333ea', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#475569'].map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-gray-900' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-md transition-colors"
              >
                {t('common_cancel')}
              </button>
              <button
                onClick={saveDeck}
                disabled={!name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
