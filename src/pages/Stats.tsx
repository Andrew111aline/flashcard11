import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flame,
  Info,
  Target,
} from 'lucide-react';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subDays,
} from 'date-fns';
import { useDB, useTranslation } from '../lib/db';
import { getNoteTitle, stripMarkdown } from '../lib/notes';
import { cn } from '../lib/utils';
import { Card, CardState, Note } from '../types';

type StatsTab = 'overview' | 'calendar' | 'memory';

interface CalendarEntry {
  due: number;
  reviewed: number;
  states: Partial<Record<CardState, number>>;
}

interface CalendarCell {
  key: string;
  date: Date;
  inMonth: boolean;
  entry: CalendarEntry;
  intensity: number;
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
}

interface CurveCanvasProps {
  lang: 'zh' | 'en';
  reviewCards: Card[];
  cards: Card[];
  showGlobal: boolean;
  days: number;
  highlightRetention: number;
}

const CARD_CURVE_COLORS = ['#0f766e', '#0369a1', '#7e22ce', '#ea580c', '#b45309'];

export function Stats() {
  const { db } = useDB();
  const t = useTranslation();
  const lang = (db.settings.lang || 'zh') as 'zh' | 'en';
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const stats = useMemo(() => {
    const now = new Date();
    const today = startOfToday();
    const todayKey = formatDateKey(today);
    const weekAgo = subDays(today, 7);
    const monthAgo = subDays(today, 30);
    const reviewCountByDate = new Map<string, number>();

    for (const review of db.reviews) {
      const key = formatDateKey(parseISO(review.reviewedAt));
      reviewCountByDate.set(key, (reviewCountByDate.get(key) || 0) + 1);
    }

    const counts = {
      total: db.cards.length,
      new: db.cards.filter((card) => card.state === 'new').length,
      learning: db.cards.filter((card) => card.state === 'learning').length,
      review: db.cards.filter((card) => card.state === 'review').length,
      relearning: db.cards.filter((card) => card.state === 'relearning').length,
    };

    const todayReviews = db.reviews.filter((review) => parseISO(review.reviewedAt) >= today).length;
    const weekReviews = db.reviews.filter((review) => parseISO(review.reviewedAt) >= weekAgo).length;
    const recentReviews = db.reviews.filter((review) => parseISO(review.reviewedAt) >= monthAgo);
    const successfulRecentReviews = recentReviews.filter((review) => review.rating >= 2).length;
    const retention = recentReviews.length > 0
      ? Math.round((successfulRecentReviews / recentReviews.length) * 100)
      : 0;

    const dailyData = Array.from({ length: 14 }).map((_, index) => {
      const date = subDays(now, 13 - index);
      const key = formatDateKey(date);
      return {
        date,
        key,
        label: format(date, 'MM/dd'),
        count: reviewCountByDate.get(key) || 0,
      };
    });

    const maxDaily = Math.max(...dailyData.map((item) => item.count), 1);
    const heatmapData = Array.from({ length: 60 }).map((_, index) => {
      const date = subDays(now, 59 - index);
      const key = formatDateKey(date);
      return { date, key, count: reviewCountByDate.get(key) || 0 };
    });

    const reviewCards = db.cards
      .filter((card) => card.state === 'review' && card.stability > 0)
      .sort((a, b) => b.stability - a.stability);

    const currentRetention = reviewCards.length > 0
      ? reviewCards.reduce((sum, card) => sum + fsrsRetention(getElapsedDays(card), card.stability), 0) / reviewCards.length
      : 0;
    const avgStability = reviewCards.length > 0
      ? reviewCards.reduce((sum, card) => sum + card.stability, 0) / reviewCards.length
      : 0;
    const targetDays = avgStability > 0 ? fsrsDaysToRetention(db.settings.retention || 0.9, avgStability) : 0;

    return {
      counts,
      currentRetention,
      avgStability,
      targetDays,
      todayKey,
      todayReviews,
      weekReviews,
      retention,
      streak: getReviewStreak(db.reviews),
      dailyData,
      maxDaily,
      heatmapData,
      reviewCards,
      topStableCards: reviewCards.slice(0, 5),
    };
  }, [db.cards, db.reviews, db.settings.retention]);

  const calendarMonth = useMemo(
    () => startOfMonth(addMonths(new Date(), calendarOffset)),
    [calendarOffset],
  );
  const calendarData = useMemo(
    () => buildCalendarData(db.cards, db.reviews, calendarMonth),
    [db.cards, db.reviews, calendarMonth],
  );
  const monthMaxDue = useMemo(() => getMonthMaxDue(calendarData), [calendarData]);
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth, calendarData, monthMaxDue),
    [calendarMonth, calendarData, monthMaxDue],
  );

  useEffect(() => {
    const defaultKey = isSameMonth(calendarMonth, new Date())
      ? stats.todayKey
      : formatDateKey(calendarMonth);

    setSelectedDateKey((current) => {
      if (current && calendarCells.some((cell) => cell.inMonth && cell.key === current)) {
        return current;
      }

      return calendarCells.find((cell) => cell.inMonth && (cell.entry.due > 0 || cell.entry.reviewed > 0))?.key || defaultKey;
    });
  }, [calendarCells, calendarMonth, stats.todayKey]);

  const selectedDayDetail = useMemo(() => {
    if (!selectedDateKey) return null;

    const selectedDate = parseDateKey(selectedDateKey);
    const dueCards = db.cards.filter((card) => formatDateKey(new Date(card.dueAt)) === selectedDateKey);
    const reviews = db.reviews.filter((review) => formatDateKey(parseISO(review.reviewedAt)) === selectedDateKey);
    const deckCounts = new Map<string, number>();
    const stateCounts: Partial<Record<CardState, number>> = {};

    dueCards.forEach((card) => {
      const deckName = db.decks.find((deck) => deck.id === card.deckId)?.name || t('stats_unknown_deck');
      deckCounts.set(deckName, (deckCounts.get(deckName) || 0) + 1);
      stateCounts[card.state] = (stateCounts[card.state] || 0) + 1;
    });

    return {
      date: selectedDate,
      dueCards,
      reviews,
      deckBreakdown: [...deckCounts.entries()].sort((a, b) => b[1] - a[1]),
      stateBreakdown: Object.entries(stateCounts) as [CardState, number][],
      canReviewNow: differenceInCalendarDays(selectedDate, startOfToday()) <= 0 && dueCards.length > 0,
      isFuture: differenceInCalendarDays(selectedDate, startOfToday()) > 0,
    };
  }, [db.cards, db.decks, db.reviews, selectedDateKey, lang]);

  const tabs = [
    { id: 'overview' as const, label: t('stats_tab_overview') },
    { id: 'calendar' as const, label: t('stats_tab_calendar') },
    { id: 'memory' as const, label: t('stats_tab_memory') },
  ];

  const weekdayLabels = lang === 'zh'
    ? ['日', '一', '二', '三', '四', '五', '六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabel = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
  }).format(calendarMonth);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-8 text-3xl font-bold text-gray-900">{t('stats_title')}</h1>

      <div className="mb-6 flex gap-1 rounded-2xl bg-slate-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition',
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<Target className="h-5 w-5 text-blue-500" />}
              label={t('stats_total_cards')}
              value={stats.counts.total}
              footer={
                <div className="mt-4 flex gap-2 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">{t('stats_new')}: {stats.counts.new}</span>
                  <span className="rounded bg-teal-50 px-2 py-1 text-teal-700">{t('stats_review')}: {stats.counts.review}</span>
                </div>
              }
            />
            <MetricCard
              icon={<Calendar className="h-5 w-5 text-purple-500" />}
              label={t('stats_reviews_today')}
              value={stats.todayReviews}
              footer={<p className="mt-2 text-sm text-gray-500">{t('stats_this_week', stats.weekReviews)}</p>}
            />
            <MetricCard
              icon={<BarChart2 className="h-5 w-5 text-green-500" />}
              label={t('stats_retention')}
              value={`${stats.retention}%`}
              footer={
                <div className="mt-4 h-1.5 w-full rounded-full bg-gray-200">
                  <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${stats.retention}%` }} />
                </div>
              }
            />
            <MetricCard
              icon={<Flame className="h-5 w-5 text-orange-500" />}
              label={t('stats_avg_stability')}
              value={stats.avgStability > 0 ? `${stats.avgStability.toFixed(1)}d` : '0d'}
              footer={<p className="mt-2 text-sm text-gray-500">{t('stats_target_eta', Math.max(0, Math.round(stats.targetDays)))}</p>}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-bold text-gray-900">{t('stats_chart_daily')}</h2>
              <div className="flex h-64 items-end gap-2">
                {stats.dailyData.map((item, index) => {
                  const height = `${(item.count / stats.maxDaily) * 100}%`;
                  return (
                    <div key={item.key} className="group relative flex flex-1 flex-col items-center">
                      <div className="relative flex w-full flex-1 items-end justify-center rounded-t-md bg-teal-100">
                        <div
                          className="w-full rounded-t-md bg-teal-500 transition-all duration-500"
                          style={{ height: item.count === 0 ? '4px' : height }}
                        />
                        <div className="pointer-events-none absolute -top-8 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {item.count} {t('stats_review')}
                        </div>
                      </div>
                      <span className="mt-2 w-full truncate text-center text-[10px] text-gray-400">
                        {index % 2 === 0 ? item.label.slice(-2) : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{t('stats_chart_heatmap')}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t('stats_heatmap_subtitle')}</p>
                </div>
                <div className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                  {t('home_streak', stats.streak)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stats.heatmapData.map((item) => {
                  const colorClass =
                    item.count > 50 ? 'bg-teal-800'
                      : item.count > 30 ? 'bg-teal-600'
                        : item.count > 10 ? 'bg-teal-400'
                          : item.count > 0 ? 'bg-teal-200'
                            : 'bg-gray-100';

                  return (
                    <div
                      key={item.key}
                      className={cn('h-4 w-4 rounded-sm transition-colors hover:ring-2 hover:ring-gray-400', colorClass)}
                      title={`${formatDisplayDate(item.date, lang)}: ${item.count} ${t('stats_review')}`}
                    />
                  );
                })}
              </div>
              <div className="mt-6 flex items-center justify-end gap-2 text-xs text-gray-500">
                <span>{t('stats_less')}</span>
                <div className="h-3 w-3 rounded-sm bg-gray-100" />
                <div className="h-3 w-3 rounded-sm bg-teal-200" />
                <div className="h-3 w-3 rounded-sm bg-teal-400" />
                <div className="h-3 w-3 rounded-sm bg-teal-600" />
                <div className="h-3 w-3 rounded-sm bg-teal-800" />
                <span>{t('stats_more')}</span>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {activeTab === 'calendar' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setCalendarOffset((value) => value - 1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label={t('stats_calendar_prev')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div className="text-center">
                <p className="text-base font-semibold text-slate-900">{monthLabel}</p>
                <p className="mt-1 text-sm text-slate-500">{t('stats_calendar_subtitle')}</p>
              </div>

              <button
                type="button"
                onClick={() => setCalendarOffset((value) => value + 1)}
                disabled={calendarOffset >= 3}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={t('stats_calendar_next')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {weekdayLabels.map((label) => (
                <div key={label} className="pb-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {label}
                </div>
              ))}

              {calendarCells.map((cell) => {
                const badge = cell.entry.due > 0
                  ? cell.entry.due
                  : cell.entry.reviewed > 0 && cell.isPast
                    ? '✓'
                    : null;
                const badgeClass = cell.entry.due > 0
                  ? cell.isFuture
                    ? 'bg-sky-600 text-white'
                    : cell.isPast
                      ? 'bg-rose-500 text-white'
                      : 'bg-teal-600 text-white'
                  : 'bg-emerald-100 text-emerald-700';

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => cell.inMonth && setSelectedDateKey(cell.key)}
                    disabled={!cell.inMonth}
                    className={cn(
                      'relative aspect-square min-h-[42px] rounded-xl text-center transition',
                      cell.inMonth ? 'cursor-pointer' : 'cursor-default opacity-0',
                      cell.inMonth && 'hover:scale-[1.04] hover:shadow-sm',
                      cell.isToday && 'ring-2 ring-teal-500 ring-offset-2 ring-offset-white',
                      selectedDateKey === cell.key && 'ring-2 ring-slate-900 ring-offset-2 ring-offset-white',
                    )}
                    style={{ background: getCalendarCellBackground(cell) }}
                    aria-label={buildCalendarAriaLabel(cell, lang, t)}
                    title={buildCalendarAriaLabel(cell, lang, t)}
                  >
                    {cell.inMonth ? (
                      <>
                        <span className={cn(
                          'text-xs font-medium tabular-nums',
                          cell.isToday ? 'text-teal-700' : cell.isPast ? 'text-slate-500' : 'text-slate-700',
                        )}>
                          {cell.date.getDate()}
                        </span>
                        {badge ? (
                          <span className={cn(
                            'absolute bottom-1.5 right-1.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                            badgeClass,
                          )}>
                            {badge}
                          </span>
                        ) : null}
                        {cell.entry.due > 0 ? (
                          <span className="absolute bottom-1 left-1/2 hidden h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-teal-600 max-[480px]:block" />
                        ) : null}
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <LegendItem label={t('stats_calendar_due')} className="bg-teal-600" />
              <LegendItem label={t('stats_calendar_done')} className="bg-emerald-100 ring-1 ring-emerald-300" />
              <LegendItem label={t('stats_calendar_today')} outlined />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 text-slate-400" />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t('stats_calendar_day_detail')}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedDayDetail
                    ? formatSelectedDateLabel(selectedDayDetail.date, lang)
                    : t('stats_calendar_no_selection')}
                </p>
              </div>
            </div>

            {selectedDayDetail ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailStatCard label={t('stats_calendar_due')} value={selectedDayDetail.dueCards.length} tone="teal" />
                  <DetailStatCard label={t('stats_calendar_reviewed')} value={selectedDayDetail.reviews.length} tone="emerald" />
                </div>

                {selectedDayDetail.deckBreakdown.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      {t('stats_calendar_deck_breakdown')}
                    </p>
                    <div className="space-y-2">
                      {selectedDayDetail.deckBreakdown.map(([name, count]) => (
                        <div key={name} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                          <span className="font-medium text-slate-800">{name}</span>
                          <span className="text-slate-500">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedDayDetail.stateBreakdown.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      {t('stats_calendar_state_breakdown')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedDayDetail.stateBreakdown.map(([state, count]) => (
                        <span key={state} className={cn('rounded-full px-3 py-1 text-xs font-medium', getStateChipClass(state))}>
                          {getStateLabel(state, t)}: {count}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedDayDetail.canReviewNow ? (
                  <a
                    href="#review"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-teal-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-700"
                  >
                    {t('stats_calendar_start_review')}
                  </a>
                ) : selectedDayDetail.isFuture && selectedDayDetail.dueCards.length > 0 ? (
                  <p className="text-sm text-slate-500">{t('stats_calendar_not_due_yet')}</p>
                ) : selectedDayDetail.dueCards.length === 0 && selectedDayDetail.reviews.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('stats_calendar_no_data')}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t('stats_calendar_no_selection')}</p>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === 'memory' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t('stats_memory_global_title')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('stats_memory_global_subtitle', stats.reviewCards.length)}</p>
              </div>
              <div className="flex gap-4">
                <MiniMetric label={t('stats_memory_current_retention')} value={`${Math.round(stats.currentRetention * 100)}%`} />
                <MiniMetric label={t('stats_memory_avg_stability')} value={stats.avgStability > 0 ? `${stats.avgStability.toFixed(1)}d` : '0d'} />
                <MiniMetric label={t('stats_memory_target_eta_short')} value={stats.targetDays > 0 ? `${Math.round(stats.targetDays)}d` : '0d'} />
              </div>
            </div>

            {stats.reviewCards.length > 0 ? (
              <CurveCanvas
                lang={lang}
                reviewCards={stats.reviewCards}
                cards={[]}
                showGlobal
                days={90}
                highlightRetention={db.settings.retention || 0.9}
              />
            ) : (
              <EmptyMemoryState label={t('stats_memory_no_review_cards')} />
            )}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">{t('stats_memory_compare_title')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('stats_memory_compare_subtitle')}</p>
            </div>

            {stats.topStableCards.length > 0 ? (
              <>
                <div className="mb-4 space-y-2">
                  {stats.topStableCards.map((card, index) => {
                    const label = getCardLabel(card, db.notes);
                    const currentRetention = Math.round(fsrsRetention(getElapsedDays(card), Math.max(card.stability, 0.1)) * 100);
                    return (
                      <div key={card.id} className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CARD_CURVE_COLORS[index % CARD_CURVE_COLORS.length] }} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{label}</p>
                          <p className="text-xs text-slate-500">S={card.stability.toFixed(1)}d · {currentRetention}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <CurveCanvas
                  lang={lang}
                  reviewCards={stats.reviewCards}
                  cards={stats.topStableCards}
                  showGlobal={false}
                  days={Math.min(120, Math.max(30, Math.ceil(Math.max(...stats.topStableCards.map((card) => card.stability)) * 3)))}
                  highlightRetention={db.settings.retention || 0.9}
                />
              </>
            ) : (
              <EmptyMemoryState label={t('stats_memory_no_review_cards')} />
            )}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t('stats_memory_histogram_title')}</h2>
            <div className="mt-4">
              {stats.reviewCards.length > 0 ? (
                <StabilityHistogram cards={stats.reviewCards} lang={lang} t={t} />
              ) : (
                <EmptyMemoryState label={t('stats_memory_histogram_empty')} />
              )}
            </div>
          </section>

          <details className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {t('stats_memory_formula_summary')}
            </summary>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-500">
              <p>
                <code className="rounded bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                  R(t, S) = (1 + 19/81 × t / S)^(-0.5)
                </code>
              </p>
              <p>{t('stats_memory_formula_note')}</p>
              <p>{t('stats_memory_formula_explainer')}</p>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  footer,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-center gap-3 text-gray-500">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {footer}
    </div>
  );
}

function DetailStatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'teal' | 'emerald';
}) {
  return (
    <div className={cn(
      'rounded-2xl border px-4 py-4',
      tone === 'teal'
        ? 'border-teal-100 bg-teal-50/70'
        : 'border-emerald-100 bg-emerald-50/70',
    )}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-bold', tone === 'teal' ? 'text-teal-700' : 'text-emerald-700')}>
        {value}
      </p>
    </div>
  );
}

function LegendItem({
  label,
  className,
  outlined = false,
}: {
  label: string;
  className?: string;
  outlined?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-sm',
          className,
          outlined && 'bg-transparent ring-2 ring-teal-500',
        )}
      />
      <span>{label}</span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-lg font-bold text-teal-700 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function EmptyMemoryState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatSelectedDateLabel(date: Date, lang: 'zh' | 'en') {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatDisplayDate(date: Date, lang: 'zh' | 'en') {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function truncate(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function differenceBetweenDays(later: Date, earlier: Date) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86400000);
}

function fsrsRetention(elapsedDays: number, stability: number) {
  if (stability <= 0 || elapsedDays < 0) return 1;
  const F = 19 / 81;
  const C = -0.5;
  return Math.pow(1 + (F * elapsedDays) / stability, C);
}

function fsrsDaysToRetention(targetRetention: number, stability: number) {
  if (stability <= 0) return 0;
  const F = 19 / 81;
  const C = -0.5;
  return (stability / F) * (Math.pow(targetRetention, 1 / C) - 1);
}

function getElapsedDays(card: Card) {
  const start = card.lastReview ? new Date(card.lastReview) : new Date(card.createdAt);
  return Math.max(0, differenceBetweenDays(new Date(), start));
}

function generateCardCurveData(card: Card, days: number) {
  const stability = Math.max(card.stability || 1, 0.1);
  const points: { t: number; r: number }[] = [];
  for (let step = 0; step <= days; step += 0.5) {
    points.push({ t: step, r: fsrsRetention(step, stability) });
  }
  return points;
}

function generateGlobalCurveData(cards: Card[], days: number) {
  if (!cards.length) return [];
  const points: { t: number; r: number }[] = [];
  for (let step = 0; step <= days; step += 0.5) {
    const avg = cards.reduce((sum, card) => sum + fsrsRetention(step, Math.max(card.stability, 0.1)), 0) / cards.length;
    points.push({ t: step, r: avg });
  }
  return points;
}

function getCardLabel(card: Card, notes: Note[]) {
  const note = notes.find((item) => item.id === card.noteId);
  if (!note) return `Card ${card.id.slice(-4)}`;
  return truncate(stripMarkdown(getNoteTitle(note)), 28);
}

function getStateLabel(state: CardState, t: (key: string, ...args: any[]) => string) {
  switch (state) {
    case 'new':
      return t('stats_new');
    case 'learning':
      return t('stats_learning');
    case 'review':
      return t('stats_review');
    default:
      return t('stats_state_relearn');
  }
}

function getStateChipClass(state: CardState) {
  switch (state) {
    case 'new':
      return 'bg-slate-100 text-slate-700';
    case 'learning':
      return 'bg-amber-50 text-amber-700';
    case 'review':
      return 'bg-teal-50 text-teal-700';
    default:
      return 'bg-rose-50 text-rose-700';
  }
}

function getReviewStreak(reviews: { reviewedAt: string }[]) {
  if (reviews.length === 0) return 0;

  const uniqueDays = new Set(reviews.map((review) => formatDateKey(parseISO(review.reviewedAt))));
  let streak = 0;
  let cursor = startOfToday();

  while (uniqueDays.has(formatDateKey(cursor))) {
    streak += 1;
    cursor = subDays(cursor, 1);
  }

  return streak;
}

function buildCalendarData(cards: Card[], reviews: { reviewedAt: string }[], month: Date) {
  const year = month.getFullYear();
  const mon = month.getMonth();
  const map = new Map<string, CalendarEntry>();

  cards.forEach((card) => {
    const due = new Date(card.dueAt);
    if (due.getFullYear() !== year || due.getMonth() !== mon) return;

    const key = formatDateKey(due);
    const entry = map.get(key) || { due: 0, reviewed: 0, states: {} };
    entry.due += 1;
    entry.states[card.state] = (entry.states[card.state] || 0) + 1;
    map.set(key, entry);
  });

  reviews.forEach((review) => {
    const date = parseISO(review.reviewedAt);
    if (date.getFullYear() !== year || date.getMonth() !== mon) return;

    const key = formatDateKey(date);
    const entry = map.get(key) || { due: 0, reviewed: 0, states: {} };
    entry.reviewed += 1;
    map.set(key, entry);
  });

  return map;
}

function getMonthMaxDue(calendarData: Map<string, CalendarEntry>) {
  let max = 0;
  calendarData.forEach((entry) => {
    if (entry.due > max) max = entry.due;
  });
  return max || 1;
}

function buildCalendarCells(month: Date, calendarData: Map<string, CalendarEntry>, monthMaxDue: number): CalendarCell[] {
  const today = startOfToday();
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
  });

  return days.map((date) => {
    const key = formatDateKey(date);
    const entry = calendarData.get(key) || { due: 0, reviewed: 0, states: {} };
    return {
      key,
      date,
      inMonth: isSameMonth(date, month),
      entry,
      intensity: entry.due > 0 ? Math.min(entry.due / monthMaxDue, 1) : 0,
      isPast: differenceInCalendarDays(date, today) < 0,
      isToday: isSameDay(date, today),
      isFuture: differenceInCalendarDays(date, today) > 0,
    };
  });
}

function getCalendarCellBackground(cell: CalendarCell) {
  if (cell.isPast && cell.entry.reviewed > 0 && cell.entry.due === 0) {
    return 'rgba(16, 185, 129, 0.16)';
  }

  if (cell.entry.due === 0) {
    return 'transparent';
  }

  return `rgba(13, 148, 136, ${0.15 + cell.intensity * 0.7})`;
}

function buildCalendarAriaLabel(
  cell: CalendarCell,
  lang: 'zh' | 'en',
  t: (key: string, ...args: any[]) => string,
) {
  const parts = [formatSelectedDateLabel(cell.date, lang)];

  if (cell.entry.due > 0) {
    parts.push(t('stats_calendar_due_aria', cell.entry.due));
  }

  if (cell.entry.reviewed > 0) {
    parts.push(t('stats_calendar_reviewed_aria', cell.entry.reviewed));
  }

  return parts.join('，');
}

function StabilityHistogram({
  cards,
  lang,
  t,
}: {
  cards: Card[];
  lang: 'zh' | 'en';
  t: (key: string, ...args: any[]) => string;
}) {
  const buckets = lang === 'zh'
    ? [
        { label: '≤7天', min: 0, max: 7 },
        { label: '8-30', min: 7, max: 30 },
        { label: '31-90', min: 30, max: 90 },
        { label: '91-180', min: 90, max: 180 },
        { label: '181-365', min: 180, max: 365 },
        { label: '>365', min: 365, max: Number.POSITIVE_INFINITY },
      ]
    : [
        { label: '≤7d', min: 0, max: 7 },
        { label: '8-30', min: 7, max: 30 },
        { label: '31-90', min: 30, max: 90 },
        { label: '91-180', min: 90, max: 180 },
        { label: '181-365', min: 180, max: 365 },
        { label: '>365', min: 365, max: Number.POSITIVE_INFINITY },
      ];

  const counts = buckets.map((bucket) =>
    cards.filter((card) => card.stability > bucket.min && card.stability <= bucket.max).length,
  );
  const maxCount = Math.max(...counts, 1);

  return (
    <div>
      <div className="flex h-32 items-end gap-2">
        {counts.map((count, index) => (
          <div key={buckets[index].label} className="flex flex-1 flex-col items-center">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md bg-teal-600/80 transition-[height] duration-500"
                style={{ height: `${(count / maxCount) * 100}%`, minHeight: count > 0 ? '4px' : '2px' }}
                title={`${buckets[index].label}: ${count}`}
              />
            </div>
            <span className="mt-2 text-[10px] text-slate-500">{buckets[index].label}</span>
            <span className="text-[11px] font-semibold text-teal-700">{count}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('stats_memory_histogram_note')}</p>
    </div>
  );
}

function CurveCanvas({
  lang,
  reviewCards,
  cards,
  showGlobal,
  days,
  highlightRetention,
}: CurveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => drawStatsCurveCanvas(canvas, {
      lang,
      reviewCards,
      cards,
      showGlobal,
      days,
      highlightRetention,
    });

    render();

    const target = canvas.parentElement || canvas;
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(render)
      : null;

    observer?.observe(target);
    window.addEventListener('resize', render);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [cards, days, highlightRetention, lang, reviewCards, showGlobal]);

  return (
    <div className="overflow-hidden rounded-2xl bg-slate-50">
      <canvas ref={canvasRef} className="h-[240px] w-full" aria-label="FSRS memory curve chart" />
    </div>
  );
}

function drawStatsCurveCanvas(
  canvas: HTMLCanvasElement,
  {
    lang,
    reviewCards,
    cards,
    showGlobal,
    days,
    highlightRetention,
  }: CurveCanvasProps,
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const palette = {
    text: '#0f172a',
    muted: '#64748b',
    border: '#cbd5e1',
    primary: '#0f766e',
    targetFill: 'rgba(21, 128, 61, 0.06)',
    targetLine: '#15803d',
    surface: '#f8fafc',
  };

  const padding = { top: 18, right: 18, bottom: 44, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const tx = (value: number) => padding.left + (value / days) * plotWidth;
  const ty = (value: number) => padding.top + (1 - value) * plotHeight;

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.targetFill;
  ctx.fillRect(padding.left, ty(1), plotWidth, ty(highlightRetention) - ty(1));

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 3]);

  [0.2, 0.4, 0.6, 0.8, 1].forEach((value) => {
    ctx.beginPath();
    ctx.moveTo(padding.left, ty(value));
    ctx.lineTo(padding.left + plotWidth, ty(value));
    ctx.stroke();
  });

  for (let step = 0; step <= days; step += 10) {
    ctx.beginPath();
    ctx.moveTo(tx(step), padding.top);
    ctx.lineTo(tx(step), padding.top + plotHeight);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = palette.targetLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  ctx.moveTo(padding.left, ty(highlightRetention));
  ctx.lineTo(padding.left + plotWidth, ty(highlightRetention));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = palette.muted;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  [0.2, 0.4, 0.6, 0.8, 1].forEach((value) => {
    ctx.fillText(`${Math.round(value * 100)}%`, padding.left - 6, ty(value));
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let step = 0; step <= days; step += 10) {
    ctx.fillText(lang === 'zh' ? `${step}天` : `${step}d`, tx(step), padding.top + plotHeight + 8);
  }

  const drawCurve = (points: { t: number; r: number }[], color: string, lineWidth = 2, alpha = 1) => {
    if (points.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = tx(point.t);
      const y = ty(clamp(point.r, 0, 1));
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  if (showGlobal && reviewCards.length > 0) {
    const globalData = generateGlobalCurveData(reviewCards, days);
    if (globalData.length > 0) {
      const gradient = ctx.createLinearGradient(padding.left, padding.top, padding.left, padding.top + plotHeight);
      gradient.addColorStop(0, 'rgba(15, 118, 110, 0.2)');
      gradient.addColorStop(1, 'rgba(15, 118, 110, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      globalData.forEach((point, index) => {
        const x = tx(point.t);
        const y = ty(clamp(point.r, 0, 1));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(tx(days), ty(0));
      ctx.lineTo(tx(0), ty(0));
      ctx.closePath();
      ctx.fill();

      drawCurve(globalData, palette.primary, 2.4);
    }
  }

  cards.slice(0, 5).forEach((card, index) => {
    const color = CARD_CURVE_COLORS[index % CARD_CURVE_COLORS.length];
    const points = generateCardCurveData(card, days);
    drawCurve(points, color, 1.6, 0.8);

    const elapsed = Math.min(getElapsedDays(card), days);
    const currentRetention = fsrsRetention(elapsed, Math.max(card.stability, 0.1));
    const cx = tx(elapsed);
    const cy = ty(clamp(currentRetention, 0, 1));

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    if (card.lastReview) {
      const dueDays = Math.max(0, differenceBetweenDays(new Date(card.dueAt), new Date(card.lastReview)));
      if (dueDays <= days) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(tx(dueDays), padding.top);
        ctx.lineTo(tx(dueDays), padding.top + plotHeight);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  });

  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = palette.muted;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(lang === 'zh' ? '距上次复习（天）' : 'Days Since Last Review', padding.left + plotWidth / 2, height - 4);

  ctx.save();
  ctx.translate(12, padding.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(lang === 'zh' ? '记忆保留率' : 'Retention', 0, 0);
  ctx.restore();

  ctx.fillStyle = palette.targetLine;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    lang === 'zh' ? `目标 ${Math.round(highlightRetention * 100)}%` : `Target ${Math.round(highlightRetention * 100)}%`,
    padding.left + 4,
    ty(highlightRetention) - 4,
  );
}
