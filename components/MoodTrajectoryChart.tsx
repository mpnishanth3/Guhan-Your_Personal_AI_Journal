'use client';

import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { parseISO, format, subDays, isValid } from 'date-fns';
import { getManualMoodLabel } from '@/lib/utils';

type RangeFilter = '7D' | '30D' | '90D' | 'ALL';

interface MoodTrajectoryChartProps {
  entries: any[];
  className?: string;
}

export function MoodTrajectoryChart({ entries, className = '' }: MoodTrajectoryChartProps) {
  const [activeRange, setActiveRange] = useState<RangeFilter>('30D');

  // Filter and strictly sort entries chronologically (oldestDate -> newestDate)
  const { chartData, avgManual, avgAi, validManualCount, validAiCount, scoreDelta } = useMemo(() => {
    const now = new Date();

    // Determine cutoff date for range filters
    let cutoffDate: Date | null = null;
    if (activeRange === '7D') cutoffDate = subDays(now, 7);
    else if (activeRange === '30D') cutoffDate = subDays(now, 30);
    else if (activeRange === '90D') cutoffDate = subDays(now, 90);

    // Normalize and validate entries
    const normalized: Array<{
      dateObj: Date;
      timestamp: number;
      dateKey: string;
      aiScore: number | null;
      manualScore: number | null;
      snippet: string;
      tags: string[];
    }> = [];

    entries.forEach((entry) => {
      // Extract AI synthesized score (supporting both Mood_Score and mood_score)
      const rawAi = typeof entry.Mood_Score === 'number'
        ? entry.Mood_Score
        : typeof entry.mood_score === 'number'
        ? entry.mood_score
        : null;
      const aiScore = rawAi !== null && !isNaN(rawAi) ? rawAi : null;

      // Extract Manual self-assessed score (supporting both Manual_Mood_Score and manual_mood_score)
      const rawManual = typeof entry.Manual_Mood_Score === 'number'
        ? entry.Manual_Mood_Score
        : typeof entry.manual_mood_score === 'number'
        ? entry.manual_mood_score
        : null;
      const manualScore = rawManual !== null && !isNaN(rawManual) ? rawManual : null;

      // Skip entries with neither score
      if (aiScore === null && manualScore === null) return;

      let dateObj: Date | null = null;
      const logicalDateStr = entry.Entry_Date || entry.entry_date;
      if (logicalDateStr) {
        try {
          const parsed = parseISO(logicalDateStr);
          if (isValid(parsed)) dateObj = parsed;
        } catch {
          dateObj = null;
        }
      }

      if (!dateObj && (entry.Created_At?.toDate || entry.createdAt?.toDate)) {
        dateObj = entry.Created_At?.toDate ? entry.Created_At.toDate() : entry.createdAt.toDate();
      } else if (!dateObj && entry.Timestamp) {
        const parsed = new Date(entry.Timestamp);
        if (isValid(parsed)) dateObj = parsed;
      }

      if (!dateObj || !isValid(dateObj)) return;

      // Range check
      if (cutoffDate && dateObj < cutoffDate) return;

      const snippet = (entry.original_prompt || entry.scrubbed_text || '').trim();
      let tags: string[] = [];
      if (Array.isArray(entry.tags)) {
        tags = entry.tags;
      } else if (typeof entry.tags === 'string' && entry.tags.trim()) {
        tags = entry.tags.split(/[,;]/).map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      }

      normalized.push({
        dateObj,
        timestamp: dateObj.getTime(),
        dateKey: format(dateObj, 'yyyy-MM-dd'),
        aiScore,
        manualScore,
        snippet,
        tags,
      });
    });

    // Sort STRICTLY in ascending chronological order (oldestDate -> newestDate)
    normalized.sort((a, b) => a.timestamp - b.timestamp);

    // Format for Recharts
    const data = normalized.map((item) => ({
      date: format(item.dateObj, 'MMM d'),
      fullDate: format(item.dateObj, 'MMMM d, yyyy'),
      rawDate: item.dateKey,
      score: item.aiScore, // Guhan AI Score
      manualScore: item.manualScore, // Manual Self-Assessed Score
      snippet: item.snippet,
      tags: item.tags,
      timestamp: item.timestamp,
    }));

    // Calculate dynamic range averages using exact math logic
    const validAiScores = data
      .map((d) => d.score)
      .filter((s): s is number => typeof s === 'number' && !isNaN(s));
    const calculatedAiAvg = validAiScores.length > 0
      ? parseFloat((validAiScores.reduce((a, b) => a + b, 0) / validAiScores.length).toFixed(1))
      : null;

    const validManualScores = data
      .map((d) => d.manualScore)
      .filter((s): s is number => typeof s === 'number' && !isNaN(s));
    const calculatedManualAvg = validManualScores.length > 0
      ? parseFloat((validManualScores.reduce((a, b) => a + b, 0) / validManualScores.length).toFixed(1))
      : null;

    // Trend delta based on the primary score available
    const primarySeries = validAiScores.length > 0 ? validAiScores : validManualScores;
    const latest = primarySeries.length > 0 ? primarySeries[primarySeries.length - 1] : null;
    const earliest = primarySeries.length > 1 ? primarySeries[0] : latest;
    const delta = latest !== null && earliest !== null ? latest - earliest : 0;

    return {
      chartData: data,
      avgManual: calculatedManualAvg,
      avgAi: calculatedAiAvg,
      validManualCount: validManualScores.length,
      validAiCount: validAiScores.length,
      scoreDelta: delta,
    };
  }, [entries, activeRange]);

  // Custom Tooltip displaying both scores side-by-side
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const item = payload[0].payload;
    const aiScore = typeof item.score === 'number' ? item.score : null;
    const manualScore = typeof item.manualScore === 'number' ? item.manualScore : null;

    return (
      <div className="bg-[#0e0e12]/95 backdrop-blur-xl border border-white/10 p-3.5 rounded-2xl shadow-2xl max-w-xs text-xs space-y-2.5 z-50">
        <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
          <span className="font-mono text-slate-400 text-[11px]">{item.fullDate}</span>
          <span className="text-[10px] font-mono text-slate-500 uppercase">Perception vs AI</span>
        </div>

        {/* Side-by-Side Dual Scores */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-center">
            <span className="block text-[10px] font-mono text-teal-400 uppercase">You (Manual)</span>
            <span className="text-base font-bold font-mono text-[#2dd4bf]">
              {manualScore !== null ? `${manualScore}/10` : 'Unrated'}
            </span>
            {manualScore !== null && (
              <span className="block text-[10px] font-mono text-teal-300/90 mt-0.5">
                {getManualMoodLabel(manualScore)}
              </span>
            )}
          </div>

          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
            <span className="block text-[10px] font-mono text-indigo-400 uppercase">Guhan (AI)</span>
            <span className="text-base font-bold font-mono text-[#818cf8]">
              {aiScore !== null ? `${aiScore}/10` : '—'}
            </span>
          </div>
        </div>

        {/* Delta comparison when both exist */}
        {manualScore !== null && aiScore !== null && (
          <div className="text-[11px] font-mono text-center pt-1 border-t border-white/5">
            {manualScore === aiScore ? (
              <span className="text-emerald-400">Aligned with Guhan</span>
            ) : manualScore > aiScore ? (
              <span className="text-teal-300">+{manualScore - aiScore} Higher perception</span>
            ) : (
              <span className="text-indigo-300">{manualScore - aiScore} Lower perception</span>
            )}
          </div>
        )}

        {item.snippet && (
          <p className="text-slate-400 text-[11px] leading-relaxed line-clamp-2 italic pt-1 border-t border-white/5">
            &ldquo;{item.snippet}&hellip;&rdquo;
          </p>
        )}

        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-white/5">
            {item.tags.map((tag: string, idx: number) => (
              <span
                key={idx}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-white/5 text-indigo-300 border border-white/5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const rangeButtons: { id: RangeFilter; label: string }[] = [
    { id: '7D', label: 'Last 7 Days' },
    { id: '30D', label: 'Last 30 Days' },
    { id: '90D', label: 'Last 90 Days' },
    { id: 'ALL', label: 'All Time' },
  ];

  return (
    <div
      className={`bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden group ${className}`}
    >
      {/* Background ambient lighting */}
      <div className="absolute -top-16 -right-16 w-36 h-36 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-white/5 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-medium text-slate-200">Mood Trajectory</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              {chartData.length} {chartData.length === 1 ? 'Point' : 'Points'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Comparative sentiment progression (Manual vs AI)
          </p>
        </div>

        {/* Time Filter Buttons: Last 7 Days, Last 30 Days, Last 90 Days, All Time */}
        <div className="flex items-center bg-[#121214] border border-white/10 p-1 rounded-xl self-start sm:self-auto">
          {rangeButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setActiveRange(btn.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all ${
                activeRange === btn.id
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sleek Insights Header: Side-by-Side Dual Average Metric Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4 relative z-10">
        {/* Your Average (Manual) - Glowing Teal */}
        <div className="bg-[#121216]/90 border border-teal-500/20 rounded-xl p-3 flex flex-col justify-between shadow-lg relative overflow-hidden group/card">
          <div className="absolute -top-6 -right-6 w-16 h-16 bg-teal-500/10 rounded-full blur-xl pointer-events-none group-hover/card:bg-teal-500/20 transition-all"></div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-teal-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_rgba(45,212,191,0.8)]"></span>
              Your Average (Manual)
            </span>
            {validManualCount > 0 && (
              <span className="text-[10px] font-mono text-slate-500">
                {validManualCount} rated
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[#2dd4bf]">
              {avgManual !== null ? avgManual.toFixed(1) : '—'}
            </span>
            {avgManual !== null && (
              <span className="text-xs font-mono text-teal-500/70">/ 10</span>
            )}
            {avgManual === null && (
              <span className="text-[11px] font-mono text-slate-500">Unrated in range</span>
            )}
          </div>
        </div>

        {/* Guhan's Average (AI) - Glowing Indigo */}
        <div className="bg-[#121216]/90 border border-indigo-500/20 rounded-xl p-3 flex flex-col justify-between shadow-lg relative overflow-hidden group/card">
          <div className="absolute -top-6 -right-6 w-16 h-16 bg-indigo-500/10 rounded-full blur-xl pointer-events-none group-hover/card:bg-indigo-500/20 transition-all"></div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#818cf8] shadow-[0_0_8px_rgba(129,140,248,0.8)]"></span>
              Guhan&apos;s Average (AI)
            </span>
            {validAiCount > 0 && (
              <span className="text-[10px] font-mono text-slate-500">
                {validAiCount} rated
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-[#818cf8]">
              {avgAi !== null ? avgAi.toFixed(1) : '—'}
            </span>
            {avgAi !== null && (
              <span className="text-xs font-mono text-indigo-400/70">/ 10</span>
            )}
            {avgAi === null && (
              <span className="text-[11px] font-mono text-slate-500">Unrated in range</span>
            )}
          </div>
        </div>
      </div>

      {/* Dual Legend indicator */}
      <div className="flex items-center gap-4 text-[11px] font-mono mb-2 px-1 text-slate-400 relative z-10">
        <span className="flex items-center gap-1.5 text-indigo-300">
          <span className="w-3.5 h-0.5 bg-[#818cf8] rounded-full inline-block"></span>
          <span>Guhan (AI)</span>
        </span>
        <span className="flex items-center gap-1.5 text-teal-300">
          <span className="w-3.5 h-0.5 border-b-2 border-dashed border-[#2dd4bf] inline-block"></span>
          <span>You (Manual)</span>
        </span>
      </div>

      {/* Visual Chart Canvas */}
      <div className="h-60 w-full relative z-10">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 15, right: 12, left: -25, bottom: 5 }}>
              <defs>
                {/* Ambient glow filter for active AI points */}
                <filter id="aiGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#818cf8" floodOpacity="0.8" />
                </filter>
                {/* Ambient glow filter for active Manual points */}
                <filter id="manualGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#2dd4bf" floodOpacity="0.8" />
                </filter>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255, 255, 255, 0.05)"
                vertical={false}
              />

              <XAxis
                dataKey="date"
                stroke="#64748b"
                fontSize={11}
                tickMargin={10}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
                tickLine={false}
              />

              <YAxis
                domain={[1, 10]}
                ticks={[1, 3, 5, 7, 10]}
                stroke="#64748b"
                fontSize={11}
                tickMargin={8}
                axisLine={false}
                tickLine={false}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: 'rgba(129, 140, 248, 0.25)',
                  strokeWidth: 1.5,
                  strokeDasharray: '4 4',
                }}
              />

              {/* AI Score Line: Ethereal glowing Indigo/Violet */}
              <Line
                type="monotone"
                dataKey="score"
                name="Guhan (AI)"
                stroke="#818cf8"
                strokeWidth={2.5}
                dot={{
                  r: 3.5,
                  fill: '#818cf8',
                  stroke: '#0a0a0c',
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 6,
                  fill: '#818cf8',
                  stroke: '#ffffff',
                  strokeWidth: 2,
                  filter: 'url(#aiGlow)',
                }}
                connectNulls={true}
              />

              {/* Manual Score Line: Deep-space glowing Teal with dashed stroke */}
              <Line
                type="monotone"
                dataKey="manualScore"
                name="You (Manual)"
                stroke="#2dd4bf"
                strokeWidth={2.5}
                strokeDasharray="5 5"
                dot={{
                  r: 3.5,
                  fill: '#2dd4bf',
                  stroke: '#0a0a0c',
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 6,
                  fill: '#2dd4bf',
                  stroke: '#ffffff',
                  strokeWidth: 2,
                  filter: 'url(#manualGlow)',
                }}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-sm text-slate-500 gap-2">
            <TrendingUp className="w-6 h-6 text-slate-600" />
            <p>Not enough trajectory data recorded for this time frame.</p>
          </div>
        )}
      </div>

      {/* Footer Metrics Summary */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-400 relative z-10 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
            <span>Manual: <strong className="text-teal-300 font-semibold">{avgManual !== null ? avgManual.toFixed(1) : '—'}</strong></span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
            <span>AI: <strong className="text-indigo-300 font-semibold">{avgAi !== null ? avgAi.toFixed(1) : '—'}</strong></span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {scoreDelta > 0 ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              +{scoreDelta} Trend ↗
            </span>
          ) : scoreDelta < 0 ? (
            <span className="text-amber-400 font-semibold flex items-center gap-1">
              {scoreDelta} Trend ↘
            </span>
          ) : (
            <span className="text-slate-400">Steady Trend →</span>
          )}
        </div>
      </div>
    </div>
  );
}
