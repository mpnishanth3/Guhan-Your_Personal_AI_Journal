'use client';

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { BarChart3, TrendingUp, Calendar, Sparkles } from 'lucide-react';
import { parseISO, format } from 'date-fns';

interface MonthlyBarChartProps {
  entries: any[];
  selectedYear: number;
  onYearChange?: (year: number) => void;
  availableYears?: number[];
  className?: string;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function MonthlyBarChart({
  entries,
  selectedYear,
  onYearChange,
  availableYears,
  className = '',
}: MonthlyBarChartProps) {
  const currentMonthIndex = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  // Aggregate journal count per month for the selected year
  const { monthlyData, totalYearCount, peakMonth, activeMonthsCount } = useMemo(() => {
    const counts = new Array(12).fill(0);
    const moodSums = new Array(12).fill(0);
    const moodCounts = new Array(12).fill(0);

    entries.forEach((entry) => {
      let dateObj: Date | null = null;
      const logicalDateStr = entry.Entry_Date || entry.entry_date;
      if (logicalDateStr) {
        try {
          dateObj = parseISO(logicalDateStr);
        } catch {
          dateObj = null;
        }
      } else if (entry.Created_At?.toDate) {
        dateObj = entry.Created_At.toDate();
      } else if (entry.createdAt?.toDate) {
        dateObj = entry.createdAt.toDate();
      }

      if (dateObj && dateObj.getFullYear() === selectedYear) {
        const monthIndex = dateObj.getMonth();
        counts[monthIndex] += 1;
        if (typeof entry.mood_score === 'number') {
          moodSums[monthIndex] += entry.mood_score;
          moodCounts[monthIndex] += 1;
        }
      }
    });

    let total = 0;
    let maxMonthIndex = 0;
    let maxCount = 0;
    let activeMonths = 0;

    const data = MONTH_NAMES.map((name, idx) => {
      const count = counts[idx];
      total += count;
      if (count > 0) activeMonths++;
      if (count > maxCount) {
        maxCount = count;
        maxMonthIndex = idx;
      }

      const avgMood = moodCounts[idx] > 0
        ? (moodSums[idx] / moodCounts[idx]).toFixed(1)
        : null;

      return {
        month: name,
        fullMonth: FULL_MONTH_NAMES[idx],
        count: count,
        avgMood: avgMood,
        isCurrentMonth: selectedYear === currentYear && idx === currentMonthIndex,
      };
    });

    return {
      monthlyData: data,
      totalYearCount: total,
      peakMonth: maxCount > 0 ? { name: FULL_MONTH_NAMES[maxMonthIndex], count: maxCount } : null,
      activeMonthsCount: activeMonths,
    };
  }, [entries, selectedYear, currentMonthIndex, currentYear]);

  // Custom modern dark tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#121214]/95 backdrop-blur-md border border-white/10 p-3.5 rounded-xl shadow-2xl text-xs font-sans">
          <p className="font-semibold text-slate-200 mb-1 flex items-center justify-between gap-4">
            <span>{data.fullMonth} {selectedYear}</span>
            {data.isCurrentMonth && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Current
              </span>
            )}
          </p>
          <div className="space-y-1 mt-2 text-slate-300">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Total Entries:</span>
              <span className="font-mono font-bold text-white text-sm">{data.count}</span>
            </div>
            {data.avgMood && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Avg Mood Score:</span>
                <span className="font-mono text-purple-300">{data.avgMood} / 10</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Find max count for Y-axis domain
  const maxBarValue = Math.max(...monthlyData.map((d) => d.count), 5);
  const yAxisTicks = [0, Math.ceil(maxBarValue / 2), maxBarValue];

  return (
    <div
      className={`bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden ${className}`}
    >
      {/* Background ambient lighting */}
      <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Header with Title, Stats Summary, and Year Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-medium text-slate-200 flex items-center gap-2">
              Monthly Reflection Volume
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-indigo-300 font-normal">
                {selectedYear}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Visualizing the total journal count per month
            </p>
          </div>
        </div>

        {/* Year Selector & Quick Summary */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {peakMonth && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-mono">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Peak: {peakMonth.name} ({peakMonth.count})</span>
            </div>
          )}

          {availableYears && availableYears.length > 1 && onYearChange && (
            <div className="flex items-center gap-1 bg-[#121214] border border-white/10 rounded-xl p-1">
              {availableYears.map((yr) => (
                <button
                  key={yr}
                  type="button"
                  onClick={() => onYearChange(yr)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
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
      </div>

      {/* Bar Chart Container */}
      <div className="h-64 w-full relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="barPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.35} />
              </linearGradient>
              <linearGradient id="barCurrent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c084fc" stopOpacity={1} />
                <stop offset="100%" stopColor="#9333ea" stopOpacity={0.5} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" opacity={0.04} vertical={false} />

            <XAxis
              dataKey="month"
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
            />

            <YAxis
              stroke="#64748b"
              fontSize={11}
              domain={[0, maxBarValue]}
              ticks={yAxisTicks}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />

            <Bar
              dataKey="count"
              radius={[6, 6, 0, 0]}
              maxBarSize={38}
            >
              {monthlyData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isCurrentMonth ? 'url(#barCurrent)' : 'url(#barPrimary)'}
                  stroke={entry.isCurrentMonth ? '#e879f9' : '#818cf8'}
                  strokeWidth={entry.count > 0 ? 1 : 0}
                  strokeOpacity={0.6}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Metrics */}
      <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2 relative z-10">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-indigo-400 to-indigo-600"></span>
            <span>Recorded Volume</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-purple-400 to-purple-600"></span>
            <span>Current Month</span>
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span>{totalYearCount} total in {selectedYear}</span>
          <span className="text-slate-600">•</span>
          <span>{activeMonthsCount}/12 active months</span>
        </div>
      </div>
    </div>
  );
}
