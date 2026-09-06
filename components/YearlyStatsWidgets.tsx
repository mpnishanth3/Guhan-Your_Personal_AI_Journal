'use client';

import React, { useMemo } from 'react';
import { BookOpen, Zap, HeartPulse, CheckSquare, Calendar, TrendingUp, Check, Flame } from 'lucide-react';
import { parseISO, format, startOfWeek, addDays, isSameDay } from 'date-fns';

interface YearlyStatsWidgetsProps {
  entries: any[];
  selectedYear: number;
  onYearChange?: (year: number) => void;
  availableYears?: number[];
  currentStreak: number;
  className?: string;
}

export function YearlyStatsWidgets({
  entries,
  selectedYear,
  onYearChange,
  availableYears,
  currentStreak,
  className = '',
}: YearlyStatsWidgetsProps) {
  // Aggregate yearly metrics
  const yearlyMetrics = useMemo(() => {
    const yearlyEntries = entries.filter((entry) => {
      let d: Date | null = null;
      const logicalDateStr = entry.Entry_Date || entry.entry_date;
      if (logicalDateStr) {
        try {
          d = parseISO(logicalDateStr);
        } catch {
          d = null;
        }
      } else if (entry.Created_At?.toDate) {
        d = entry.Created_At.toDate();
      } else if (entry.createdAt?.toDate) {
        d = entry.createdAt.toDate();
      }
      return d && d.getFullYear() === selectedYear;
    });

    const totalEntries = yearlyEntries.length;

    // Mood calculations (both AI synthesized and Manual self-assessed)
    const aiMoodScores = yearlyEntries
      .map((e) => (typeof e.Mood_Score === 'number' ? e.Mood_Score : typeof e.mood_score === 'number' ? e.mood_score : null))
      .filter((s): s is number => typeof s === 'number');
    const avgAiMood =
      aiMoodScores.length > 0
        ? (aiMoodScores.reduce((a, b) => a + b, 0) / aiMoodScores.length).toFixed(1)
        : null;

    const manualMoodScores = yearlyEntries
      .map((e) => (typeof e.Manual_Mood_Score === 'number' ? e.Manual_Mood_Score : typeof e.manual_mood_score === 'number' ? e.manual_mood_score : null))
      .filter((s): s is number => typeof s === 'number');
    const avgManualMood =
      manualMoodScores.length > 0
        ? (manualMoodScores.reduce((a, b) => a + b, 0) / manualMoodScores.length).toFixed(1)
        : null;

    // Unique active days
    const uniqueDays = new Set(
      yearlyEntries.map((e) => {
        if (e.Entry_Date) return e.Entry_Date;
        if (e.entry_date) return e.entry_date;
        if (e.Created_At?.toDate) return e.Created_At.toDate().toISOString().split('T')[0];
        if (e.createdAt?.toDate) return e.createdAt.toDate().toISOString().split('T')[0];
        return null;
      }).filter(Boolean)
    );

    // Total task throughput: Active + Completed + Archived_Task_Count
    const totalTasks = yearlyEntries.reduce((acc, entry) => {
      // 1. Active tasks (array or semicolon-delimited string)
      const activeField = entry.Actionable_Tasks ?? entry.actionable_tasks;
      let activeCount = 0;
      if (Array.isArray(activeField)) {
        activeCount = activeField.length;
      } else if (typeof activeField === 'string' && activeField.trim()) {
        activeCount = activeField
          .split(';')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0).length;
      }

      // 2. Completed tasks (with backwards compatibility for legacy Discarded_Tasks)
      const completedField =
        entry.Completed_Tasks ?? entry.completed_tasks ?? entry.Discarded_Tasks ?? entry.discarded_tasks;
      let completedCount = 0;
      if (Array.isArray(completedField)) {
        completedCount = completedField.length;
      } else if (typeof completedField === 'string' && completedField.trim()) {
        completedCount = completedField
          .split(';')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0).length;
      }

      // 3. Archived tasks count (permanently preserved when clearing completed history)
      const archivedCount = Number(entry.Archived_Task_Count ?? entry.archived_task_count ?? 0) || 0;

      return acc + activeCount + completedCount + archivedCount;
    }, 0);

    // Active months
    const activeMonths = new Set(
      yearlyEntries.map((entry) => {
        let d: Date | null = null;
        if (entry.entry_date) {
          try {
            d = parseISO(entry.entry_date);
          } catch {
            d = null;
          }
        } else if (entry.createdAt?.toDate) {
          d = entry.createdAt.toDate();
        }
        return d ? d.getMonth() : null;
      }).filter((m) => m !== null)
    );

    return {
      totalEntries,
      avgMood: avgAiMood,
      avgAiMood,
      avgManualMood,
      manualRatedCount: manualMoodScores.length,
      aiRatedCount: aiMoodScores.length,
      activeDaysCount: uniqueDays.size,
      totalTasks,
      activeMonthsCount: activeMonths.size,
    };
  }, [entries, selectedYear]);

  // Mood label based on score
  const moodLabel = useMemo(() => {
    if (!yearlyMetrics.avgMood) return 'No scores yet';
    const score = parseFloat(yearlyMetrics.avgMood);
    if (score >= 7.5) return 'Positive & Thriving';
    if (score >= 6.0) return 'Balanced & Mindful';
    if (score >= 4.5) return 'Reflective & Steady';
    return 'Seeking Grounding';
  }, [yearlyMetrics.avgMood]);

  // Weekly progress for the current week (Monday to Sunday)
  const weeklyDays = useMemo(() => {
    const today = new Date();
    // Monday as start of week (weekStartsOn: 1)
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const initials = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // Map of active date strings 'YYYY-MM-DD'
    const activeDates = new Set<string>();
    entries.forEach((e) => {
      if (e.entry_date) {
        activeDates.add(e.entry_date);
      } else if (e.createdAt?.toDate) {
        activeDates.add(format(e.createdAt.toDate(), 'yyyy-MM-dd'));
      }
    });

    return initials.map((initial, index) => {
      const dayDate = addDays(weekStart, index);
      const dateKey = format(dayDate, 'yyyy-MM-dd');
      const isCompleted = activeDates.has(dateKey);
      const isDayToday = isSameDay(dayDate, today);
      const isFuture = dayDate > today && !isDayToday;

      return {
        initial,
        dateKey,
        formattedDate: format(dayDate, 'EEE, MMM d'),
        isCompleted,
        isToday: isDayToday,
        isFuture,
      };
    });
  }, [entries]);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Top Header with Year Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
            <span>Yearly Performance & Overview</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-normal">
              {selectedYear}
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Aggregated metrics and reflective consistency for the year
          </p>
        </div>

        {availableYears && availableYears.length > 1 && onYearChange && (
          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-[#121214] border border-white/10 p-1 rounded-xl">
            <span className="text-[11px] font-mono text-slate-500 px-2">Year:</span>
            {availableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => onYearChange(yr)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                  selectedYear === yr
                    ? 'bg-indigo-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid of 4 Aggregated Yearly Stats Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Total Reflections */}
        <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Yearly Reflections
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <BookOpen className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 relative z-10">
            <span className="text-4xl font-light tracking-tight text-white">
              {yearlyMetrics.totalEntries}
            </span>
            <span className="text-xs text-slate-500 font-mono">Entries</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 relative z-10 font-mono">
            <span>{yearlyMetrics.activeMonthsCount}/12 active months</span>
            <span>~{(yearlyMetrics.totalEntries / 12).toFixed(1)}/mo</span>
          </div>
        </div>

        {/* 2. Yearly Average Mood (Dual Manual vs AI) */}
        <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Yearly Average Mood
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <HeartPulse className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-3 relative z-10">
            <div>
              <span className="text-3xl font-light tracking-tight text-[#2dd4bf]">
                {yearlyMetrics.avgManualMood || '—'}
              </span>
              <span className="text-[10px] text-teal-400 font-mono ml-1">You</span>
            </div>
            <span className="text-slate-600 font-light text-xl">/</span>
            <div>
              <span className="text-3xl font-light tracking-tight text-[#818cf8]">
                {yearlyMetrics.avgAiMood || '—'}
              </span>
              <span className="text-[10px] text-indigo-400 font-mono ml-1">AI</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 relative z-10 font-mono">
            <span className="text-teal-300 truncate">
              {yearlyMetrics.manualRatedCount > 0 ? `${yearlyMetrics.manualRatedCount} self-rated` : moodLabel}
            </span>
            <span className="text-slate-500">
              {yearlyMetrics.aiRatedCount} AI-rated
            </span>
          </div>
        </div>

        {/* 3. Consistency & Streak */}
        <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-amber-500/30 transition-all flex flex-col justify-between">
          <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl transition-all ${
            currentStreak > 0 ? 'bg-amber-500/10 group-hover:bg-amber-500/20' : 'bg-white/5'
          }`}></div>
          <div className="flex items-center justify-between mb-2 relative z-10">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Active Days & Streak
            </span>
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${
              currentStreak > 0
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                : 'bg-white/5 border-white/10 text-slate-500'
            }`}>
              <Zap className={`w-4 h-4 ${currentStreak > 0 ? 'text-amber-400 fill-amber-400/20' : 'text-slate-500'}`} />
            </div>
          </div>

          {/* Monday-to-Sunday Weekly Progress Bar / Icon Row */}
          <div className="my-1.5 relative z-10">
            <div className="flex items-center justify-between gap-1">
              {weeklyDays.map((day, idx) => (
                <div
                  key={idx}
                  className="flex flex-col items-center gap-1 flex-1"
                  title={`${day.formattedDate}: ${
                    day.isCompleted
                      ? 'Reflection completed'
                      : day.isToday
                      ? 'Today (Pending reflection)'
                      : day.isFuture
                      ? 'Upcoming'
                      : 'No entry'
                  }`}
                >
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      day.isToday
                        ? 'text-indigo-300 font-bold'
                        : day.isCompleted
                        ? 'text-slate-300'
                        : 'text-slate-500'
                    }`}
                  >
                    {day.initial}
                  </span>

                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      day.isCompleted
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)] border border-indigo-400/60 font-bold'
                        : day.isToday
                        ? 'bg-indigo-950/40 border border-indigo-500/40 text-indigo-400 animate-pulse'
                        : 'bg-white/5 border border-white/5 text-slate-600'
                    }`}
                  >
                    {day.isCompleted ? (
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          day.isToday ? 'bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)]' : 'bg-slate-700'
                        }`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Streak status text & badge */}
          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-xs relative z-10 font-mono">
            <span className={currentStreak > 0 ? 'text-slate-300 text-[11px]' : 'text-slate-500 text-[11px]'}>
              Current Streak:
            </span>
            {currentStreak > 0 ? (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)] font-bold text-[11px]">
                <Flame className="w-3 h-3 text-amber-400 fill-amber-400" />
                {currentStreak} {currentStreak === 1 ? 'day streak' : 'days streak'}
              </span>
            ) : (
              <span className="text-slate-500 font-normal text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                0 days
              </span>
            )}
          </div>
        </div>

        {/* 4. Action Items Synthesized */}
        <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-emerald-500/30 transition-all">
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Synthesized Tasks
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 relative z-10">
            <span className="text-4xl font-light tracking-tight text-white">
              {yearlyMetrics.totalTasks}
            </span>
            <span className="text-xs text-emerald-400 font-mono">Tasks</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 relative z-10 font-mono">
            <span>Generated by Guhan AI</span>
            <span className="text-emerald-300">Actionable</span>
          </div>
        </div>
      </div>
    </div>
  );
}
