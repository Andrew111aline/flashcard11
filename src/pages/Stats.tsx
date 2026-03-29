import { useMemo } from 'react';
import { useDB, useTranslation } from '../lib/db';
import { BarChart2, Calendar, Flame, Target } from 'lucide-react';
import { format, subDays, isSameDay, parseISO } from 'date-fns';

export function Stats() {
  const { db } = useDB();
  const t = useTranslation();

  const stats = useMemo(() => {
    const now = new Date();
    
    // Card counts by state
    const counts = {
      total: db.cards.length,
      new: db.cards.filter(c => c.state === 'new').length,
      learning: db.cards.filter(c => c.state === 'learning').length,
      review: db.cards.filter(c => c.state === 'review').length,
      relearning: db.cards.filter(c => c.state === 'relearning').length,
    };

    // Reviews
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const todayReviews = db.reviews.filter(r => new Date(r.reviewedAt) >= today).length;
    const weekReviews = db.reviews.filter(r => new Date(r.reviewedAt) >= weekAgo).length;

    // Retention (last 30 days)
    const recentReviews = db.reviews.filter(r => new Date(r.reviewedAt) >= monthAgo);
    const successReviews = recentReviews.filter(r => r.rating >= 2).length;
    const retention = recentReviews.length > 0 
      ? Math.round((successReviews / recentReviews.length) * 100) 
      : 0;

    // Daily reviews for chart (last 14 days)
    const dailyData = Array.from({ length: 14 }).map((_, i) => {
      const d = subDays(now, 13 - i);
      const count = db.reviews.filter(r => isSameDay(parseISO(r.reviewedAt), d)).length;
      return { date: format(d, 'MMM dd'), count };
    });

    const maxDaily = Math.max(...dailyData.map(d => d.count), 1);

    // Heatmap (last 60 days)
    const heatmapData = Array.from({ length: 60 }).map((_, i) => {
      const d = subDays(now, 59 - i);
      const count = db.reviews.filter(r => isSameDay(parseISO(r.reviewedAt), d)).length;
      return { date: d, count };
    });

    return { counts, todayReviews, weekReviews, retention, dailyData, maxDaily, heatmapData };
  }, [db.cards, db.reviews]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('nav_stats')}</h1>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2 text-gray-500">
            <Target className="w-5 h-5 text-blue-500" />
            <span className="font-medium">{t('stats_total_cards')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.counts.total}</p>
          <div className="mt-4 flex gap-2 text-xs">
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded">{t('stats_new')}: {stats.counts.new}</span>
            <span className="bg-teal-50 text-teal-700 px-2 py-1 rounded">{t('stats_review')}: {stats.counts.review}</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2 text-gray-500">
            <Calendar className="w-5 h-5 text-purple-500" />
            <span className="font-medium">{t('stats_reviews_today')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.todayReviews}</p>
          <p className="text-sm text-gray-500 mt-2">{t('stats_this_week', stats.weekReviews)}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2 text-gray-500">
            <BarChart2 className="w-5 h-5 text-green-500" />
            <span className="font-medium">{t('stats_retention')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.retention}%</p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-4">
            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${stats.retention}%` }}></div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2 text-gray-500">
            <Flame className="w-5 h-5 text-orange-500" />
            <span className="font-medium">{t('stats_learning')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.counts.learning}</p>
          <p className="text-sm text-gray-500 mt-2">{t('stats_relearning', stats.counts.relearning)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Reviews Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{t('stats_chart_daily')}</h3>
          <div className="h-64 flex items-end gap-2">
            {stats.dailyData.map((d, i) => {
              const height = `${(d.count / stats.maxDaily) * 100}%`;
              return (
                <div key={i} className="flex-1 flex flex-col items-center group relative">
                  <div className="w-full bg-teal-100 rounded-t-md relative flex-1 flex items-end justify-center">
                    <div 
                      className="w-full bg-teal-500 rounded-t-md transition-all duration-500"
                      style={{ height: d.count === 0 ? '4px' : height }}
                    />
                    {/* Tooltip */}
                    <div className="absolute -top-8 bg-gray-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {d.count} {t('stats_review')}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-2 truncate w-full text-center">
                    {i % 2 === 0 ? d.date.split(' ')[1] : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{t('stats_chart_heatmap')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {stats.heatmapData.map((d, i) => {
              let colorClass = 'bg-gray-100';
              if (d.count > 0) colorClass = 'bg-teal-200';
              if (d.count > 10) colorClass = 'bg-teal-400';
              if (d.count > 30) colorClass = 'bg-teal-600';
              if (d.count > 50) colorClass = 'bg-teal-800';

              return (
                <div 
                  key={i} 
                  className={`w-4 h-4 rounded-sm ${colorClass} transition-colors hover:ring-2 hover:ring-gray-400`}
                  title={`${format(d.date, 'MMM dd, yyyy')}: ${d.count} ${t('stats_review')}`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 mt-6 text-xs text-gray-500">
            <span>{t('stats_less')}</span>
            <div className="w-3 h-3 rounded-sm bg-gray-100" />
            <div className="w-3 h-3 rounded-sm bg-teal-200" />
            <div className="w-3 h-3 rounded-sm bg-teal-400" />
            <div className="w-3 h-3 rounded-sm bg-teal-600" />
            <div className="w-3 h-3 rounded-sm bg-teal-800" />
            <span>{t('stats_more')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
