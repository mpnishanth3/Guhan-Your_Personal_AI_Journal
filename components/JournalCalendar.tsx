'use client';

import React, { useState, useMemo } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  subMonths,
  isToday,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

export interface CalendarEntry {
  id: string;
  Entry_Date?: string;
  entry_date?: string;
  Created_At?: any;
  createdAt?: any;
  mood_score?: number;
  original_prompt?: string;
  scrubbed_text?: string;
  actionable_tasks?: string[];
  response_text?: string;
  media_path?: string;
  media_url?: string;
  media_type?: string;
  hasMedia?: boolean;
}

interface JournalCalendarProps {
  entries: CalendarEntry[];
  selectedDate: string | null; // 'YYYY-MM-DD'
  onSelectDate: (dateStr: string | null) => void;
  className?: string;
}

export function JournalCalendar({
  entries,
  selectedDate,
  onSelectDate,
  className = '',
}: JournalCalendarProps) {
  // Current visible month in calendar view
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    if (selectedDate) {
      const parsed = parseISO(selectedDate);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  });

  // Map entries by date key 'YYYY-MM-DD'
  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();

    entries.forEach((entry) => {
      let dateKey = '';
      if (entry.Entry_Date) {
        dateKey = entry.Entry_Date;
      } else if (entry.entry_date) {
        dateKey = entry.entry_date;
      } else if (entry.Created_At?.toDate) {
        dateKey = format(entry.Created_At.toDate(), 'yyyy-MM-dd');
      } else if (entry.createdAt?.toDate) {
        dateKey = format(entry.createdAt.toDate(), 'yyyy-MM-dd');
      }

      if (dateKey) {
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(entry);
      }
    });

    return map;
  }, [entries]);

  // Calendar grid calculations
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [startDate, endDate]);

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));
  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    onSelectDate(format(today, 'yyyy-MM-dd'));
  };

  return (
    <div
      className={`bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col ${className}`}
    >
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-indigo-400" />
          <h4 className="text-base font-medium text-slate-100">
            {format(currentMonth, 'MMMM yyyy')}
          </h4>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToday}
            className="px-2.5 py-1 text-xs font-mono bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 transition-colors"
          >
            Today
          </button>
          <div className="flex items-center">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Weekday Labels */}
      <div className="grid grid-cols-7 gap-1 text-center mb-2">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <div
            key={day}
            className="text-[11px] font-mono font-medium text-slate-500 uppercase tracking-wider py-1"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDate === dateStr;
          const dayIsToday = isToday(day);
          const dayEntries = entriesByDate.get(dateStr) || [];
          const hasEntries = dayEntries.length > 0;
          const hasMedia =
            hasEntries &&
            dayEntries.some((e) => Boolean(e.media_path || e.media_url || e.hasMedia));

          // Average mood for color accent
          let avgMood: number | null = null;
          if (hasEntries) {
            const scores = dayEntries
              .map((e) => e.mood_score)
              .filter((s): s is number => typeof s === 'number');
            if (scores.length > 0) {
              avgMood = scores.reduce((a, b) => a + b, 0) / scores.length;
            }
          }

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => {
                if (isSelected) {
                  onSelectDate(null);
                } else {
                  onSelectDate(dateStr);
                }
              }}
              className={`
                group relative h-11 rounded-xl flex flex-col items-center justify-center text-xs font-mono transition-all duration-300
                ${!isCurrentMonth ? 'text-slate-600 opacity-40 hover:opacity-80' : 'text-slate-200'}
                ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-bold shadow-[0_0_18px_rgba(99,102,241,0.5)] ring-2 ring-indigo-400'
                    : hasMedia
                    ? 'bg-indigo-950/40 hover:bg-indigo-500/10 ring-1 ring-indigo-500/50 hover:ring-indigo-400 text-indigo-100'
                    : hasEntries
                    ? 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 text-slate-200 hover:text-white'
                    : 'hover:bg-white/5 border border-transparent text-slate-400'
                }
                ${dayIsToday && !isSelected ? 'ring-1 ring-white/30 font-semibold' : ''}
              `}
              title={
                hasEntries
                  ? `${dayEntries.length} reflection${dayEntries.length > 1 ? 's' : ''} on ${format(
                      day,
                      'MMM d, yyyy'
                    )}${hasMedia ? ' (Media attached)' : ''}${avgMood !== null ? ` (Mood: ${avgMood.toFixed(1)}/10)` : ''}`
                  : format(day, 'MMM d, yyyy')
              }
            >
              {/* Date Number */}
              <span className="relative z-10 leading-none">{format(day, 'd')}</span>

              {/* Minimalist Geometric Indicators */}
              {hasEntries && (
                <div className="flex items-center gap-1 mt-1 z-10">
                  {hasMedia ? (
                    // Subtle glowing circle for media attachments
                    <span
                      className={`w-2 h-2 rounded-full border border-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.7)] transition-transform duration-300 group-hover:scale-110 ${
                        isSelected ? 'bg-white border-white' : 'bg-indigo-500/30'
                      }`}
                      title="Media attached"
                    />
                  ) : (
                    // Solid dot for standard text reflections
                    <span
                      className={`w-1.5 h-1.5 rounded-full transition-transform duration-300 group-hover:scale-110 ${
                        isSelected
                          ? 'bg-white'
                          : avgMood !== null && avgMood >= 7
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                          : avgMood !== null && avgMood <= 4
                          ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]'
                          : 'bg-slate-400'
                      }`}
                      title="Reflection recorded"
                    />
                  )}
                  {dayEntries.length > 1 && (
                    <span
                      className={`text-[8px] leading-none font-bold ${
                        isSelected ? 'text-white/80' : 'text-slate-500'
                      }`}
                    >
                      +{dayEntries.length - 1}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Calendar Footer Status & Legend */}
      <div className="mt-4 pt-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
        {/* Visual Indicators Legend */}
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Reflection</span>
          </span>
          <span className="flex items-center gap-1.5 text-indigo-300">
            <span className="w-2 h-2 rounded-full border border-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.7)] bg-indigo-500/30" />
            <span>Media Attached</span>
          </span>
        </div>

        {selectedDate ? (
          <button
            type="button"
            onClick={() => onSelectDate(null)}
            className="text-indigo-400 hover:text-indigo-300 hover:underline font-mono text-[11px] self-end sm:self-auto transition-colors"
          >
            Clear Filter (Show All)
          </button>
        ) : (
          <span className="font-mono text-[11px] text-slate-500 self-end sm:self-auto">
            {entries.length} total {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>
    </div>
  );
}
