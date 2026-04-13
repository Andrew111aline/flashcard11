import { useDB, useTranslation } from '../lib/db';
import { Layers, Flame, Play } from 'lucide-react';

export function Home() {
  const { db } = useDB();
  const t = useTranslation();

  const now = new Date();
  const noteIds = new Set(db.notes.map((note) => note.id));
  const dueCards = db.cards.filter((card) => noteIds.has(card.noteId) && new Date(card.dueAt) <= now);
  const streak = getReviewStreak(db.reviews);
  const dueByDeck = db.decks
    .map((deck) => ({
      ...deck,
      due: dueCards.filter((card) => card.deckId === deck.id).length,
    }))
    .filter((deck) => deck.due > 0);

  const getGreeting = () => {
    const hour = now.getHours();
    if (hour < 12) return t('home_greeting_morning');
    if (hour < 18) return t('home_greeting_afternoon');
    return t('home_greeting_evening');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{getGreeting()}</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-4 bg-teal-50 text-teal-600 rounded-full">
            <Layers className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">{t('nav_home')}</p>
            <p className="text-3xl font-bold text-gray-900">{dueCards.length}</p>
            <p className="text-sm text-gray-500 mt-1">{t('home_due_count', dueCards.length)}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-4 bg-orange-50 text-orange-500 rounded-full">
            <Flame className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">{t('stats_streak')}</p>
            <p className="text-3xl font-bold text-gray-900">{t('home_streak', streak)}</p>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-4">{t('home_btn_review')}</h2>
      
      {dueByDeck.length === 0 ? (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center">
          <p className="text-gray-500 mb-4">{t('home_due_zero')}</p>
          <a href="#decks" className="inline-flex items-center gap-2 text-teal-600 font-medium hover:text-teal-700">
            {t('nav_decks')}
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dueByDeck.map(deck => (
            <a
              key={deck.id}
              href={`#review?deckId=${deck.id}`}
              className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:border-teal-300 hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div 
                  className="w-4 h-4 rounded-full" 
                  style={{ backgroundColor: deck.color || '#0d9488' }}
                />
                <span className="bg-teal-50 text-teal-700 text-xs font-bold px-2 py-1 rounded-full">
                  {t('decks_due_count', deck.due)}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 text-lg mb-1 truncate">{deck.name}</h3>
              <div className="flex items-center text-teal-600 text-sm font-medium mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="w-4 h-4 mr-1" /> {t('home_btn_review')}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function getReviewStreak(reviews: { reviewedAt: string }[]) {
  if (reviews.length === 0) return 0;

  const uniqueDays = new Set(reviews.map((review) => formatDateKey(new Date(review.reviewedAt))));
  let streak = 0;
  const cursor = startOfLocalDay(new Date());

  while (uniqueDays.has(formatDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function startOfLocalDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
