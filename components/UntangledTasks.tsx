'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  doc,
  updateDoc,
  arrayRemove,
  arrayUnion,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import {
  CheckSquare,
  History,
  CheckCircle,
  RotateCcw,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';

interface UntangledTasksProps {
  entry: any;
  userId?: string;
  onEntryUpdated?: (updatedEntry: any) => void;
  className?: string;
  variant?: 'modal' | 'card';
}

/**
 * Normalizes actionable or completed tasks field into a clean string array.
 * Supports string arrays and legacy semicolon-separated strings.
 * Defaults missing or null values gracefully to [].
 */
function parseTaskList(field: any): string[] {
  if (Array.isArray(field)) {
    return field.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof field === 'string' && field.trim()) {
    return field
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

export interface ParsedCognitiveTask {
  category: string;
  cleanTaskText: string;
}

/**
 * Extracts category tag and clean task text using regex.
 * Defaults category to 'Standard' if no tag is found.
 */
export function parseCognitiveTask(taskString: string): ParsedCognitiveTask {
  if (!taskString) return { category: 'Standard', cleanTaskText: '' };
  const match = taskString.match(/^\[(.*?)\]\s*(.*)$/);
  if (match) {
    const rawTag = match[1].trim();
    const cleanTaskText = match[2].trim() || taskString;
    const lower = rawTag.toLowerCase();
    let category = rawTag;
    if (lower === 'deep work') category = 'Deep Work';
    else if (lower === 'frictionless') category = 'Frictionless';
    else if (lower === 'anti-task' || lower === 'antitask') category = 'Anti-Task';
    else if (lower === 'standard') category = 'Standard';

    return { category, cleanTaskText };
  }
  return { category: 'Standard', cleanTaskText: taskString };
}

/**
 * Tailwind styling mapping for cognitive load energy levels:
 * - Deep Work: border-l-2 border-indigo-500 bg-indigo-500/5 (Heavy cognitive load)
 * - Frictionless: border-l-2 border-teal-400 bg-teal-400/5 (Quick 2-minute tasks)
 * - Anti-Task: border-l-2 border-rose-500 bg-rose-500/5 (Permission to disconnect)
 * - Standard: border-l-2 border-slate-600 bg-white/5
 */
export const COGNITIVE_LOAD_STYLES: Record<string, { card: string; labelColor: string }> = {
  'Deep Work': {
    card: 'border-l-2 border-indigo-500 bg-indigo-500/5',
    labelColor: 'text-indigo-400',
  },
  'Frictionless': {
    card: 'border-l-2 border-teal-400 bg-teal-400/5',
    labelColor: 'text-teal-400',
  },
  'Anti-Task': {
    card: 'border-l-2 border-rose-500 bg-rose-500/5',
    labelColor: 'text-rose-400',
  },
  'Standard': {
    card: 'border-l-2 border-slate-600 bg-white/5',
    labelColor: 'text-slate-500',
  },
};

export function UntangledTasks({
  entry,
  userId,
  onEntryUpdated,
  className = '',
  variant = 'card',
}: UntangledTasksProps) {
  // Local state for instant optimistic UI snappiness
  const [activeTasks, setActiveTasks] = useState<string[]>(() =>
    parseTaskList(entry?.Actionable_Tasks ?? entry?.actionable_tasks)
  );
  const [completedTasks, setCompletedTasks] = useState<string[]>(() =>
    parseTaskList(
      entry?.Completed_Tasks ??
        entry?.completed_tasks ??
        entry?.Discarded_Tasks ??
        entry?.discarded_tasks
    )
  );
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [mutatingTaskIndex, setMutatingTaskIndex] = useState<{
    type: 'complete' | 'restore';
    index: number;
  } | null>(null);
  const [isClearing, setIsClearing] = useState<boolean>(false);

  // Sync internal state whenever the active entry or tasks change
  useEffect(() => {
    setActiveTasks(parseTaskList(entry?.Actionable_Tasks ?? entry?.actionable_tasks));
    setCompletedTasks(
      parseTaskList(
        entry?.Completed_Tasks ??
          entry?.completed_tasks ??
          entry?.Discarded_Tasks ??
          entry?.discarded_tasks
      )
    );
  }, [
    entry?.id,
    entry?.Actionable_Tasks,
    entry?.actionable_tasks,
    entry?.Completed_Tasks,
    entry?.completed_tasks,
    entry?.Discarded_Tasks,
    entry?.discarded_tasks,
  ]);

  // If entry has neither active nor completed tasks, gracefully omit section
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    return null;
  }

  // Handle Complete Action: remove from active (arrayRemove), add to completed (arrayUnion)
  const handleCompleteTask = async (index: number) => {
    if (!userId || !entry?.id) return;
    const taskToComplete = activeTasks[index];
    if (!taskToComplete) return;

    setMutatingTaskIndex({ type: 'complete', index });

    // 1. Instant Optimistic UI Update
    const prevActive = [...activeTasks];
    const prevCompleted = [...completedTasks];
    const newActive = activeTasks.filter((_, i) => i !== index);
    const newCompleted = [taskToComplete, ...completedTasks];

    setActiveTasks(newActive);
    setCompletedTasks(newCompleted);

    const updatedEntry = {
      ...entry,
      Actionable_Tasks: newActive,
      actionable_tasks: newActive,
      Completed_Tasks: newCompleted,
      completed_tasks: newCompleted,
    };
    onEntryUpdated?.(updatedEntry);

    // 2. Atomic Firestore Mutation using arrayRemove & arrayUnion
    try {
      const entryRef = doc(db, 'users', userId, 'entries', entry.id);
      try {
        await updateDoc(entryRef, {
          Actionable_Tasks: arrayRemove(taskToComplete),
          Completed_Tasks: arrayUnion(taskToComplete),
          actionable_tasks: arrayRemove(taskToComplete),
          completed_tasks: arrayUnion(taskToComplete),
          updatedAt: serverTimestamp(),
        });
      } catch (atomicErr) {
        // Fallback for legacy documents where tasks might have been stored as raw strings
        await updateDoc(entryRef, {
          Actionable_Tasks: newActive,
          Completed_Tasks: newCompleted,
          actionable_tasks: newActive,
          completed_tasks: newCompleted,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('Failed to complete task in Firestore:', err);
      // Rollback on network or Firestore error
      setActiveTasks(prevActive);
      setCompletedTasks(prevCompleted);
      onEntryUpdated?.(entry);
    } finally {
      setMutatingTaskIndex(null);
    }
  };

  // Handle Restoration: remove from completed, append to active
  const handleRestoreTask = async (index: number) => {
    if (!userId || !entry?.id) return;
    const taskToRestore = completedTasks[index];
    if (!taskToRestore) return;

    setMutatingTaskIndex({ type: 'restore', index });

    // 1. Instant Optimistic UI Update
    const prevActive = [...activeTasks];
    const prevCompleted = [...completedTasks];
    const newCompleted = completedTasks.filter((_, i) => i !== index);
    const newActive = [...activeTasks, taskToRestore];

    setActiveTasks(newActive);
    setCompletedTasks(newCompleted);

    const updatedEntry = {
      ...entry,
      Actionable_Tasks: newActive,
      actionable_tasks: newActive,
      Completed_Tasks: newCompleted,
      completed_tasks: newCompleted,
    };
    onEntryUpdated?.(updatedEntry);

    // 2. Atomic Firestore Mutation reversing arrayRemove & arrayUnion
    try {
      const entryRef = doc(db, 'users', userId, 'entries', entry.id);
      try {
        await updateDoc(entryRef, {
          Completed_Tasks: arrayRemove(taskToRestore),
          Actionable_Tasks: arrayUnion(taskToRestore),
          completed_tasks: arrayRemove(taskToRestore),
          actionable_tasks: arrayUnion(taskToRestore),
          updatedAt: serverTimestamp(),
        });
      } catch (atomicErr) {
        // Fallback for legacy documents
        await updateDoc(entryRef, {
          Actionable_Tasks: newActive,
          Completed_Tasks: newCompleted,
          actionable_tasks: newActive,
          completed_tasks: newCompleted,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('Failed to restore task in Firestore:', err);
      // Rollback on network or Firestore error
      setActiveTasks(prevActive);
      setCompletedTasks(prevCompleted);
      onEntryUpdated?.(entry);
    } finally {
      setMutatingTaskIndex(null);
    }
  };

  // Safe "Clear History" Logic: wipe Completed_Tasks and increment Archived_Task_Count
  const handleClearCompleted = async () => {
    if (!userId || !entry?.id || isClearing) return;
    const tasksToClear = completedTasks.length;
    if (tasksToClear === 0) return;

    setIsClearing(true);
    const prevCompleted = [...completedTasks];
    const prevArchived = Number(entry?.Archived_Task_Count ?? entry?.archived_task_count ?? 0) || 0;
    const nextArchived = prevArchived + tasksToClear;

    // 1. Instant Optimistic UI Update
    setCompletedTasks([]);
    const updatedEntry = {
      ...entry,
      Completed_Tasks: [],
      completed_tasks: [],
      Archived_Task_Count: nextArchived,
      archived_task_count: nextArchived,
    };
    onEntryUpdated?.(updatedEntry);

    // 2. Database Transaction: Overwrite Completed_Tasks with [] & increment(tasksToClear)
    try {
      const entryRef = doc(db, 'users', userId, 'entries', entry.id);
      await updateDoc(entryRef, {
        Completed_Tasks: [],
        completed_tasks: [],
        Discarded_Tasks: [],
        discarded_tasks: [],
        Archived_Task_Count: increment(tasksToClear),
        archived_task_count: increment(tasksToClear),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to clear completed history in Firestore:', err);
      // Rollback on failure
      setCompletedTasks(prevCompleted);
      const rollbackEntry = {
        ...entry,
        Completed_Tasks: prevCompleted,
        completed_tasks: prevCompleted,
        Archived_Task_Count: prevArchived,
        archived_task_count: prevArchived,
      };
      onEntryUpdated?.(rollbackEntry);
    } finally {
      setIsClearing(false);
    }
  };

  const isModal = variant === 'modal';

  return (
    <div
      className={`rounded-xl border border-white/5 bg-[#070709]/80 backdrop-blur-sm transition-all ${
        isModal ? 'p-4' : 'p-3 mb-4'
      } ${className}`}
    >
      {/* Section Header with Title & History Icon Button Toggle */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px] font-mono text-indigo-300 uppercase tracking-wider font-semibold">
            Untangled Next Steps
          </span>
          {activeTasks.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
              {activeTasks.length}
            </span>
          )}
        </div>

        {/* Minimalist History Toggle Button (Hide / Unhide) */}
        <button
          type="button"
          onClick={() => setShowHistory((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-mono transition-all duration-200 ${
            showHistory
              ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/10'
          }`}
          title={showHistory ? 'Hide completed insights history' : 'Unhide completed insights history'}
        >
          {showHistory ? (
            <>
              <EyeOff className="w-3 h-3 text-indigo-300" />
              <span>Hide History{completedTasks.length > 0 ? ` (${completedTasks.length})` : ''}</span>
            </>
          ) : (
            <>
              <Eye className="w-3 h-3 text-indigo-400" />
              <span>Unhide History{completedTasks.length > 0 ? ` (${completedTasks.length})` : ''}</span>
            </>
          )}
        </button>
      </div>

      {/* Active Tasks List */}
      {activeTasks.length > 0 ? (
        <ul className="space-y-2 text-xs">
          {activeTasks.map((task, idx) => {
            const isCompletingThis =
              mutatingTaskIndex?.type === 'complete' && mutatingTaskIndex.index === idx;
            const { category, cleanTaskText } = parseCognitiveTask(task);
            const styleConfig =
              COGNITIVE_LOAD_STYLES[category] || COGNITIVE_LOAD_STYLES['Standard'];

            return (
              <li
                key={idx}
                className={`group relative flex items-start justify-between gap-2.5 pl-3 pr-2 py-2 rounded-r-md text-sm text-slate-300 transition-all duration-150 hover:bg-white/[0.08] ${styleConfig.card}`}
              >
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  {/* Category Name Label */}
                  <span className="text-[10px] text-slate-500 tracking-widest font-mono uppercase font-medium">
                    {category}
                  </span>
                  <span className="leading-relaxed text-slate-200 break-words font-sans text-xs sm:text-sm">
                    {cleanTaskText}
                  </span>
                </div>

                {/* Hover Action: Complete / Resolve Button */}
                <div className="shrink-0 flex items-center pt-0.5">
                  <button
                    type="button"
                    disabled={Boolean(mutatingTaskIndex)}
                    onClick={() => handleCompleteTask(idx)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all p-1 text-slate-500 hover:text-teal-400 hover:bg-teal-500/10 rounded-md border border-transparent hover:border-teal-500/20"
                    title="Complete and resolve insight"
                  >
                    {isCompletingThis ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-slate-500 italic py-1">
          All prioritized steps have been completed or cleared.
        </p>
      )}

      {/* Completed Insights History */}
      {showHistory && (
        <div className="mt-3 pt-2.5 border-t border-white/5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between mb-2 text-[10px] font-mono text-slate-500 uppercase">
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="flex items-center gap-1.5 text-teal-400/90 hover:text-teal-300 transition-colors group cursor-pointer"
              title="Click to hide completed insights history"
            >
              <CheckCircle className="w-3 h-3 text-teal-400" />
              <span>Completed Insights History</span>
              <EyeOff className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity ml-1" />
            </button>
            <div className="flex items-center gap-2">
              {completedTasks.length > 0 && (
                <span className="italic normal-case text-slate-600 hidden sm:inline">Hover to restore</span>
              )}
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5 transition-colors"
                title="Hide completed insights history"
              >
                <EyeOff className="w-2.5 h-2.5 text-slate-400" />
                <span>Hide</span>
              </button>
            </div>
          </div>

          {completedTasks.length > 0 ? (
            <div className="space-y-2">
              <ul className="space-y-1.5 text-xs">
                {completedTasks.map((task, idx) => {
                  const isRestoringThis =
                    mutatingTaskIndex?.type === 'restore' && mutatingTaskIndex.index === idx;
                  const { category, cleanTaskText } = parseCognitiveTask(task);
                  const styleConfig =
                    COGNITIVE_LOAD_STYLES[category] || COGNITIVE_LOAD_STYLES['Standard'];

                  return (
                    <li
                      key={idx}
                      className={`group relative flex items-start justify-between gap-2.5 pl-3 pr-2 py-1.5 rounded-r-md text-teal-500/70 line-through opacity-75 hover:opacity-100 transition-all duration-150 ${styleConfig.card}`}
                    >
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-[9px] text-teal-500/50 tracking-widest font-mono uppercase">
                          {category}
                        </span>
                        <span className="leading-relaxed break-words text-xs text-teal-500/70 line-through">
                          {cleanTaskText}
                        </span>
                      </div>

                      {/* Hover Action: Restore Button */}
                      <div className="shrink-0 flex items-center pt-0.5">
                        <button
                          type="button"
                          disabled={Boolean(mutatingTaskIndex)}
                          onClick={() => handleRestoreTask(idx)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 text-slate-500 hover:text-teal-300 hover:bg-teal-500/10 rounded-md border border-transparent hover:border-teal-500/20"
                          title="Restore task to active Untangled Next Steps"
                        >
                          {isRestoringThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Minimalist Slate Wipe Button */}
              <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between">
                <button
                  type="button"
                  disabled={isClearing}
                  onClick={handleClearCompleted}
                  className="text-xs text-slate-500 hover:text-rose-400 transition-colors flex items-center gap-1.5 font-mono cursor-pointer disabled:opacity-50"
                  title="Wipe completed list while preserving count in yearly analytics"
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                      <span>Clearing...</span>
                    </>
                  ) : (
                    'Clear completed'
                  )}
                </button>
                <span className="text-[10px] text-slate-600 font-mono">
                  Preserves analytics
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic py-1">
              No completed insights recorded in history.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
