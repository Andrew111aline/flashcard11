import { useState, useEffect, useMemo } from 'react';
import { useDB, useTranslation } from '../lib/db';
import { FSRS } from '../lib/fsrs';
import { Card } from '../types';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

export function Review() {
  const { db, setDB } = useDB();
  const t = useTranslation();
  const [deckId, setDeckId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Card[]>([]);
  const [current, setCurrent] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, total: 0 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = params.get('deckId');
    setDeckId(id);

    if (id) {
      const now = new Date();
      const due = db.cards.filter(c => c.deckId === id && new Date(c.dueAt) <= now);
      
      // Sort by priority: relearning > learning > review > new
      const priority = { relearning: 1, learning: 2, review: 3, new: 4 };
      due.sort((a, b) => priority[a.state] - priority[b.state]);
      
      setQueue(due);
      setSessionStats({ reviewed: 0, total: due.length });
    }
  }, [db.cards]); // Re-run when cards change, but we need to be careful not to reset queue mid-session

  // To prevent resetting queue mid-session, we should only initialize it once per deck load
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = params.get('deckId');
    if (id !== deckId) {
      setDeckId(id);
      const now = new Date();
      const due = db.cards.filter(c => c.deckId === id && new Date(c.dueAt) <= now);
      const priority = { relearning: 1, learning: 2, review: 3, new: 4 };
      due.sort((a, b) => priority[a.state] - priority[b.state]);
      setQueue(due);
      setSessionStats({ reviewed: 0, total: due.length });
      setCurrent(0);
      setIsFlipped(false);
    }
  }, [window.location.hash, db.cards]);

  const currentCard = queue[current];
  const fsrs = useMemo(() => new FSRS(db.settings), [db.settings]);
  
  const previews = useMemo(() => {
    if (!currentCard) return null;
    return fsrs.previewSchedule(currentCard, new Date(), t('lang') as any);
  }, [currentCard, fsrs, t]);

  const handleRate = (rating: number) => {
    if (!currentCard) return;

    const now = new Date();
    const updatedCard = fsrs.schedule(currentCard, rating, now);

    setDB(prev => {
      const newCards = prev.cards.map(c => c.id === updatedCard.id ? updatedCard : c);
      const newReviews = [
        ...prev.reviews,
        {
          cardId: currentCard.id,
          rating,
          state: currentCard.state,
          scheduledDays: updatedCard.scheduledDays,
          reviewedAt: now.toISOString()
        }
      ];
      return { ...prev, cards: newCards, reviews: newReviews };
    });

    const newQueue = [...queue];
    
    // If learning/relearning and still due today (minutes), push to end of queue
    if ((updatedCard.state === 'learning' || updatedCard.state === 'relearning') && new Date(updatedCard.dueAt) <= new Date(now.getTime() + 86400000)) {
       // For simplicity in this session, if it's learning/relearning, we add it to the end of the queue
       // In a real app, we'd wait for the exact minute, but here we just append it
       newQueue.push(updatedCard);
       setSessionStats(prev => ({ ...prev, total: prev.total + 1 }));
    }

    setSessionStats(prev => ({ ...prev, reviewed: prev.reviewed + 1 }));
    setQueue(newQueue);
    setCurrent(prev => prev + 1);
    setIsFlipped(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentCard) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped(true);
      } else if (isFlipped) {
        if (e.key === '1') handleRate(1);
        if (e.key === '2') handleRate(2);
        if (e.key === '3') handleRate(3);
        if (e.key === '4') handleRate(4);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCard, isFlipped, handleRate]);

  if (!deckId) {
    return (
      <div className="p-6 text-center">
        <p>{t('review_no_deck')}</p>
        <a href="#decks" className="text-teal-600 hover:underline">{t('nav_decks')}</a>
      </div>
    );
  }

  const deck = db.decks.find(d => d.id === deckId);

  if (!currentCard || current >= queue.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-gray-50">
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-gray-100 text-center max-w-md w-full">
          <div className="w-20 h-20 bg-teal-50 text-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('review_complete_title')}</h2>
          <p className="text-gray-500 mb-8">{t('review_complete_desc', sessionStats.reviewed)}</p>
          <a 
            href="#home"
            className="block w-full bg-teal-600 text-white py-3 rounded-xl font-medium hover:bg-teal-700 transition-colors"
          >
            {t('nav_home')}
          </a>
        </div>
      </div>
    );
  }

  const progress = (sessionStats.reviewed / sessionStats.total) * 100;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <a href="#decks" className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <h1 className="font-bold text-gray-900 truncate max-w-[200px] sm:max-w-xs">{deck?.name}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm font-medium text-gray-500">
          <span>{sessionStats.reviewed} / {sessionStats.total}</span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="h-1 bg-gray-200 w-full">
        <div 
          className="h-full bg-teal-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main Review Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-2xl perspective-1000">
          <div 
            className={`relative w-full transition-transform duration-500 transform-style-3d cursor-pointer ${isFlipped ? 'rotate-y-180' : ''}`}
            style={{ minHeight: '400px' }}
            onClick={() => !isFlipped && setIsFlipped(true)}
          >
            {/* Front */}
            <div className="absolute inset-0 backface-hidden bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col">
              <div className="flex-1 flex items-center justify-center text-center">
                <div className="prose prose-lg max-w-none text-gray-900 whitespace-pre-wrap text-2xl font-medium">
                  {currentCard.front}
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-gray-100 text-center text-gray-400 text-sm font-medium">
                {t('review_show_answer')}
              </div>
            </div>

            {/* Back */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <div className="pb-6 mb-6 border-b border-gray-100 text-center">
                  <div className="prose max-w-none text-gray-500 whitespace-pre-wrap text-lg">
                    {currentCard.front}
                  </div>
                </div>
                <div className="flex items-center justify-center text-center min-h-[150px]">
                  <div className="prose prose-lg max-w-none text-gray-900 whitespace-pre-wrap text-xl">
                    {currentCard.back}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rating Buttons */}
        <div className={`w-full max-w-2xl mt-8 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="grid grid-cols-4 gap-2 sm:gap-4">
            <button
              onClick={() => handleRate(1)}
              className="flex flex-col items-center justify-center py-3 px-2 bg-white border-2 border-red-100 rounded-xl hover:bg-red-50 hover:border-red-200 transition-colors group"
            >
              <span className="text-red-600 font-bold mb-1">{t('review_btn_again')}</span>
              <span className="text-xs text-red-400 font-medium">{previews?.[1]}</span>
              <span className="hidden sm:block text-[10px] text-gray-300 mt-1 group-hover:text-red-300">Press 1</span>
            </button>
            <button
              onClick={() => handleRate(2)}
              className="flex flex-col items-center justify-center py-3 px-2 bg-white border-2 border-orange-100 rounded-xl hover:bg-orange-50 hover:border-orange-200 transition-colors group"
            >
              <span className="text-orange-500 font-bold mb-1">{t('review_btn_hard')}</span>
              <span className="text-xs text-orange-400 font-medium">{previews?.[2]}</span>
              <span className="hidden sm:block text-[10px] text-gray-300 mt-1 group-hover:text-orange-300">Press 2</span>
            </button>
            <button
              onClick={() => handleRate(3)}
              className="flex flex-col items-center justify-center py-3 px-2 bg-white border-2 border-green-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-colors group"
            >
              <span className="text-green-600 font-bold mb-1">{t('review_btn_good')}</span>
              <span className="text-xs text-green-500 font-medium">{previews?.[3]}</span>
              <span className="hidden sm:block text-[10px] text-gray-300 mt-1 group-hover:text-green-300">Press 3</span>
            </button>
            <button
              onClick={() => handleRate(4)}
              className="flex flex-col items-center justify-center py-3 px-2 bg-white border-2 border-blue-100 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group"
            >
              <span className="text-blue-600 font-bold mb-1">{t('review_btn_easy')}</span>
              <span className="text-xs text-blue-400 font-medium">{previews?.[4]}</span>
              <span className="hidden sm:block text-[10px] text-gray-300 mt-1 group-hover:text-blue-300">Press 4</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
