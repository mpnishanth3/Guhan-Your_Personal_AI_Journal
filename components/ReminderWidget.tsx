'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import {
  format,
  parseISO,
  isToday,
  endOfDay,
  isTomorrow,
  addHours,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  getDay,
} from 'date-fns';
import {
  Bell,
  CheckCircle2,
  Circle,
  Clock,
  Trash2,
  Plus,
  X,
  Calendar as CalendarIcon,
  Sparkles,
  History,
  Pencil,
  Flag,
  RotateCcw,
  ChevronLeft,
  RefreshCw,
  AlertTriangle,
  Sliders,
} from 'lucide-react';

export type RecurrencePreset =
  | 'never'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'monthly'
  | 'every_3_months'
  | 'every_6_months'
  | 'yearly'
  | 'custom';

export type CustomFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  type: RecurrencePreset;
  customFrequency?: CustomFrequency;
  customInterval?: number;
}

export interface ReminderItem {
  id: string;
  Title: string;
  Scheduled_Date: string;
  Scheduled_Time: string;
  isCompleted: boolean;
  isFlagged: boolean;
  recurrence: RecurrenceRule;
  seriesId?: string | null;
  Status: 'pending' | 'completed';
  Timestamp: string;
  completedAt?: string | null;
}

interface ReminderWidgetProps {
  userId: string;
  className?: string;
}

export function normalizeRecurrence(raw: any): RecurrenceRule {
  if (!raw) return { type: 'never' };
  if (typeof raw === 'string') {
    if (raw === 'none') return { type: 'never' };
    const validPresets: RecurrencePreset[] = [
      'never',
      'hourly',
      'daily',
      'weekdays',
      'weekends',
      'weekly',
      'monthly',
      'every_3_months',
      'every_6_months',
      'yearly',
      'custom',
    ];
    if (validPresets.includes(raw as RecurrencePreset)) {
      return { type: raw as RecurrencePreset };
    }
    return { type: 'never' };
  }
  if (typeof raw === 'object') {
    const type = (raw.type || 'never') as RecurrencePreset;
    const freq = (raw.customFrequency || 'daily') as CustomFrequency;
    const interval = typeof raw.customInterval === 'number' ? Math.max(1, raw.customInterval) : 1;
    return {
      type,
      customFrequency: freq,
      customInterval: interval,
    };
  }
  return { type: 'never' };
}

export function getRecurrenceLabel(rule: RecurrenceRule): string {
  if (!rule || rule.type === 'never') return 'Does not repeat';
  switch (rule.type) {
    case 'hourly':
      return 'Repeats Hourly';
    case 'daily':
      return 'Repeats Daily';
    case 'weekdays':
      return 'Repeats on Weekdays (Mon-Fri)';
    case 'weekends':
      return 'Repeats on Weekends (Sat-Sun)';
    case 'weekly':
      return 'Repeats Weekly';
    case 'monthly':
      return 'Repeats Monthly';
    case 'every_3_months':
      return 'Repeats every 3 months';
    case 'every_6_months':
      return 'Repeats every 6 months';
    case 'yearly':
      return 'Repeats Yearly';
    case 'custom': {
      const interval = rule.customInterval || 1;
      const freq = rule.customFrequency || 'daily';
      const unitMap: Record<CustomFrequency, { single: string; plural: string }> = {
        hourly: { single: 'hour', plural: 'hours' },
        daily: { single: 'day', plural: 'days' },
        weekly: { single: 'week', plural: 'weeks' },
        monthly: { single: 'month', plural: 'months' },
        yearly: { single: 'year', plural: 'years' },
      };
      const unit = interval === 1 ? unitMap[freq].single : unitMap[freq].plural;
      return `Repeats every ${interval > 1 ? `${interval} ` : ''}${unit}`;
    }
    default:
      return 'Does not repeat';
  }
}

export function computeNextOccurrence(baseDate: Date, rule: RecurrenceRule): Date {
  const date = new Date(baseDate);

  switch (rule.type) {
    case 'hourly':
      return addHours(date, 1);

    case 'daily':
      return addDays(date, 1);

    case 'weekdays': {
      // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
      const day = getDay(date);
      if (day === 5) {
        // Friday -> Monday (+3 days)
        return addDays(date, 3);
      } else if (day === 6) {
        // Saturday -> Monday (+2 days)
        return addDays(date, 2);
      } else {
        // Sunday (0) -> Monday (+1 day), Mon-Thu -> +1 day
        return addDays(date, 1);
      }
    }

    case 'weekends': {
      // 0 = Sunday, 6 = Saturday
      const day = getDay(date);
      if (day === 6) {
        // Saturday -> Sunday (+1 day)
        return addDays(date, 1);
      } else if (day === 0) {
        // Sunday -> Saturday (+6 days)
        return addDays(date, 6);
      } else {
        // Mon-Fri: jump to next Saturday
        return addDays(date, 6 - day);
      }
    }

    case 'weekly':
      return addWeeks(date, 1);

    case 'monthly':
      return addMonths(date, 1);

    case 'every_3_months':
      return addMonths(date, 3);

    case 'every_6_months':
      return addMonths(date, 6);

    case 'yearly':
      return addYears(date, 1);

    case 'custom': {
      const interval = Math.max(1, rule.customInterval || 1);
      const freq = rule.customFrequency || 'daily';
      switch (freq) {
        case 'hourly':
          return addHours(date, interval);
        case 'daily':
          return addDays(date, interval);
        case 'weekly':
          return addWeeks(date, interval);
        case 'monthly':
          return addMonths(date, interval);
        case 'yearly':
          return addYears(date, interval);
        default:
          return addDays(date, interval);
      }
    }

    default:
      return addDays(date, 1);
  }
}

export function ReminderWidget({ userId, className = '' }: ReminderWidgetProps) {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [activeTab, setActiveTab] = useState<'present' | 'future'>('present');
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  // Quick manual add form state
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newIsFlagged, setNewIsFlagged] = useState(false);
  const [newRecurrenceType, setNewRecurrenceType] = useState<RecurrencePreset>('never');
  const [newCustomFrequency, setNewCustomFrequency] = useState<CustomFrequency>('daily');
  const [newCustomInterval, setNewCustomInterval] = useState<number>(2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editRecurrenceType, setEditRecurrenceType] = useState<RecurrencePreset>('never');
  const [editCustomFrequency, setEditCustomFrequency] = useState<CustomFrequency>('daily');
  const [editCustomInterval, setEditCustomInterval] = useState<number>(2);
  const [isUpdating, setIsUpdating] = useState(false);

  // Deletion modal state for recurring items
  const [deleteTarget, setDeleteTarget] = useState<ReminderItem | null>(null);

  useEffect(() => {
    if (!userId) return;

    const remindersRef = collection(db, 'users', userId, 'reminders');
    const q = query(remindersRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ReminderItem[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          const schedTime =
            data.Scheduled_Date || data.Scheduled_Time || data.scheduled_time || new Date().toISOString();
          const isComp =
            typeof data.isCompleted === 'boolean'
              ? data.isCompleted
              : data.Status === 'completed' || data.status === 'completed';
          const isFlag = Boolean(data.isFlagged || data.is_flagged);
          const recRule = normalizeRecurrence(data.recurrence);

          list.push({
            id: d.id,
            Title: data.Title || data.title || 'Untitled Reminder',
            Scheduled_Date: schedTime,
            Scheduled_Time: schedTime,
            isCompleted: isComp,
            isFlagged: isFlag,
            recurrence: recRule,
            seriesId: data.seriesId || null,
            Status: isComp ? 'completed' : 'pending',
            Timestamp: data.Timestamp || data.timestamp || new Date().toISOString(),
            completedAt: data.completedAt || null,
          });
        });

        setReminders(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching reminders snapshot:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const now = new Date();
  const endOfTodayTime = endOfDay(now);

  // "Present": Strictly display only active reminders scheduled for current local day (or past overdue)
  const presentReminders = reminders
    .filter((r) => {
      if (r.isCompleted) return false;
      try {
        const sched = parseISO(r.Scheduled_Date || r.Scheduled_Time);
        return sched <= endOfTodayTime;
      } catch {
        return true;
      }
    })
    .sort((a, b) => {
      if (a.isFlagged !== b.isFlagged) return a.isFlagged ? -1 : 1;
      return new Date(a.Scheduled_Date).getTime() - new Date(b.Scheduled_Date).getTime();
    });

  // "Future": Display all upcoming active reminders scheduled strictly for tomorrow and beyond.
  // Sorted strictly in Ascending Order by date.
  const futureReminders = reminders
    .filter((r) => {
      if (r.isCompleted) return false;
      try {
        const sched = parseISO(r.Scheduled_Date || r.Scheduled_Time);
        return sched > endOfTodayTime;
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      return new Date(a.Scheduled_Date).getTime() - new Date(b.Scheduled_Date).getTime();
    });

  // Completed / History records
  const completedReminders = reminders
    .filter((r) => r.isCompleted)
    .sort((a, b) => {
      const timeA = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.Timestamp).getTime();
      const timeB = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.Timestamp).getTime();
      return timeB - timeA;
    });

  const displayedReminders = activeTab === 'present' ? presentReminders : futureReminders;

  // Intercept "Mark as Complete": Rolling generation for complex recurring rules
  const handleToggleComplete = async (item: ReminderItem) => {
    try {
      const nextCompleted = !item.isCompleted;
      const ref = doc(db, 'users', userId, 'reminders', item.id);

      // 1. Mark current reminder complete
      await updateDoc(ref, {
        isCompleted: nextCompleted,
        Status: nextCompleted ? 'completed' : 'pending',
        completedAt: nextCompleted ? new Date().toISOString() : null,
      });

      // 2. Rolling Generation: If marked complete and recurring, autonomously generate the next instance
      if (nextCompleted && item.recurrence && item.recurrence.type !== 'never') {
        const currentDate = parseISO(item.Scheduled_Date || item.Scheduled_Time);
        const nextDate = computeNextOccurrence(currentDate, item.recurrence);
        const seriesId = item.seriesId || `series_${item.id}`;

        // Ensure original document has seriesId preserved
        if (!item.seriesId) {
          await updateDoc(ref, { seriesId });
        }

        // Create the next active instance in the series
        await addDoc(collection(db, 'users', userId, 'reminders'), {
          Title: item.Title,
          Scheduled_Date: nextDate.toISOString(),
          Scheduled_Time: nextDate.toISOString(),
          isCompleted: false,
          isFlagged: item.isFlagged,
          recurrence: item.recurrence,
          seriesId: seriesId,
          Status: 'pending',
          Timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to toggle completion status with rolling generation:', err);
    }
  };

  // Toggle Priority Flag
  const handleToggleFlag = async (item: ReminderItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const nextFlag = !item.isFlagged;
      const ref = doc(db, 'users', userId, 'reminders', item.id);
      await updateDoc(ref, {
        isFlagged: nextFlag,
      });
    } catch (err) {
      console.error('Failed to toggle flag:', err);
    }
  };

  // Delete flow trigger (checks if recurring)
  const handleDeleteClick = (item: ReminderItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (item.recurrence && item.recurrence.type !== 'never') {
      setDeleteTarget(item);
    } else {
      executeDeleteSingle(item.id);
    }
  };

  // Delete only this single instance
  const executeDeleteSingle = async (id: string) => {
    try {
      const ref = doc(db, 'users', userId, 'reminders', id);
      await deleteDoc(ref);
      if (editingId === id) setEditingId(null);
    } catch (err) {
      console.error('Failed to delete reminder:', err);
    } finally {
      setDeleteTarget(null);
    }
  };

  // Delete all future instances of the recurring series
  const executeDeleteAllFuture = async (item: ReminderItem) => {
    try {
      if (item.seriesId) {
        const q = query(
          collection(db, 'users', userId, 'reminders'),
          where('seriesId', '==', item.seriesId)
        );
        const snap = await getDocs(q);
        const promises: Promise<void>[] = [];
        snap.forEach((d) => {
          promises.push(deleteDoc(d.ref));
        });
        await Promise.all(promises);
      } else {
        await deleteDoc(doc(db, 'users', userId, 'reminders', item.id));
      }
      if (editingId === item.id) setEditingId(null);
    } catch (err) {
      console.error('Failed to delete recurring series:', err);
    } finally {
      setDeleteTarget(null);
    }
  };

  // Start Editing
  const startEdit = (item: ReminderItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingId(item.id);
    setEditTitle(item.Title);
    setEditRecurrenceType(item.recurrence.type || 'never');
    setEditCustomFrequency(item.recurrence.customFrequency || 'daily');
    setEditCustomInterval(item.recurrence.customInterval || 2);
    try {
      const date = parseISO(item.Scheduled_Date || item.Scheduled_Time);
      const localStr = format(date, "yyyy-MM-dd'T'HH:mm");
      setEditTime(localStr);
    } catch {
      setEditTime('');
    }
  };

  // Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editTitle.trim()) return;

    setIsUpdating(true);
    try {
      const targetTime = editTime ? new Date(editTime).toISOString() : new Date().toISOString();
      const updatedRecurrence: RecurrenceRule = {
        type: editRecurrenceType,
        ...(editRecurrenceType === 'custom'
          ? {
              customFrequency: editCustomFrequency,
              customInterval: Math.max(1, editCustomInterval),
            }
          : {}),
      };

      const ref = doc(db, 'users', userId, 'reminders', editingId);
      await updateDoc(ref, {
        Title: editTitle.trim(),
        Scheduled_Date: targetTime,
        Scheduled_Time: targetTime,
        recurrence: updatedRecurrence,
      });
      setEditingId(null);
    } catch (err) {
      console.error('Failed to update reminder:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Create New Reminder
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !userId) return;

    setIsSubmitting(true);
    try {
      const targetTime = newTime ? new Date(newTime).toISOString() : new Date().toISOString();
      const recRule: RecurrenceRule = {
        type: newRecurrenceType,
        ...(newRecurrenceType === 'custom'
          ? {
              customFrequency: newCustomFrequency,
              customInterval: Math.max(1, newCustomInterval),
            }
          : {}),
      };

      const seriesId =
        recRule.type !== 'never'
          ? `series_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
          : null;

      await addDoc(collection(db, 'users', userId, 'reminders'), {
        Title: newTitle.trim(),
        Scheduled_Date: targetTime,
        Scheduled_Time: targetTime,
        isCompleted: false,
        isFlagged: newIsFlagged,
        recurrence: recRule,
        seriesId: seriesId,
        Status: 'pending',
        Timestamp: new Date().toISOString(),
      });

      setNewTitle('');
      setNewTime('');
      setNewIsFlagged(false);
      setNewRecurrenceType('never');
      setIsAdding(false);
    } catch (err) {
      console.error('Failed to add reminder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatScheduledDisplay = (isoStr: string) => {
    try {
      const date = parseISO(isoStr);
      if (isToday(date)) {
        return `Today at ${format(date, 'h:mm a')}`;
      }
      if (isTomorrow(date)) {
        return `Tomorrow at ${format(date, 'h:mm a')}`;
      }
      return format(date, 'EEE, MMM d • h:mm a');
    } catch {
      return 'Scheduled';
    }
  };

  return (
    <div
      className={`bg-[#050505]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl transition-all duration-300 hover:border-indigo-500/30 hover:shadow-[0_0_30px_rgba(99,102,241,0.12)] flex flex-col justify-between relative ${className}`}
    >
      <div>
        {/* Header with Title, History Toggle & Add Trigger */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-slate-200">
                  {showHistory ? 'Completed History' : 'Sanctuary Reminders'}
                </h3>
                {showHistory && (
                  <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">
                    Vault Archive
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {showHistory
                  ? 'History of fulfilled intentions and sealed commitments'
                  : 'Autonomous & rolling recurring vault alerts'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Minimalist History Icon */}
            <button
              type="button"
              onClick={() => {
                setShowHistory(!showHistory);
                setEditingId(null);
                setDeleteTarget(null);
              }}
              className={`p-1.5 rounded-lg border transition-all ${
                showHistory
                  ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.3)]'
                  : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-indigo-300 border-white/10'
              }`}
              title={showHistory ? 'Back to active reminders' : `View Completed History (${completedReminders.length})`}
            >
              <History className="w-4 h-4" />
            </button>

            {/* Quick Add Button */}
            {!showHistory && (
              <button
                type="button"
                onClick={() => setIsAdding(!isAdding)}
                className={`p-1.5 rounded-lg border transition-all ${
                  isAdding
                    ? 'bg-white/15 text-white border-white/20'
                    : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-indigo-300 border-white/10'
                }`}
                title={isAdding ? 'Close form' : 'Add manual reminder'}
              >
                {isAdding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {/* View Mode 1: Completed History View */}
        {showHistory ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back to Present / Future
              </button>
              <span className="font-mono text-[11px] text-slate-500">
                {completedReminders.length} completed
              </span>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[280px] pr-1 custom-scrollbar">
              {completedReminders.length === 0 ? (
                <div className="py-12 px-4 text-center">
                  <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    No completed reminders in the vault history yet.
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Check off active reminders in Present or Future to archive them here.
                  </p>
                </div>
              ) : (
                completedReminders.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all text-slate-400"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleComplete(item)}
                      className="shrink-0 text-emerald-400 hover:text-slate-400 transition-colors"
                      title="Restore to active view"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs line-through text-slate-500 truncate">{item.Title}</p>
                        {item.recurrence && item.recurrence.type !== 'never' && (
                          <span
                            className="shrink-0 text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-white/5 text-slate-500 border border-white/5"
                            title={getRecurrenceLabel(item.recurrence)}
                          >
                            {getRecurrenceLabel(item.recurrence)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-slate-600">
                        <span>Due: {formatScheduledDisplay(item.Scheduled_Date)}</span>
                        {item.completedAt && (
                          <span>• Fulfilled: {format(parseISO(item.completedAt), 'MMM d, h:mm a')}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleComplete(item)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-300 rounded hover:bg-white/5 transition-all"
                        title="Restore to active reminders"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => executeDeleteSingle(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 rounded hover:bg-white/5 transition-all"
                        title="Delete permanently"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* View Mode 2: Present and Future Tabs */
          <>
            {/* Tab Switcher: "Present" vs "Future" */}
            <div className="flex items-center p-1 bg-[#121214] border border-white/10 rounded-xl mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('present')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'present'
                    ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Present</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-slate-300 ml-1">
                  {presentReminders.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('future')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'future'
                    ? 'bg-purple-600/30 text-purple-200 border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>Future</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-slate-300 ml-1">
                  {futureReminders.length}
                </span>
              </button>
            </div>

            {/* Quick Add Form with iPhone-Style Recurrence Picker */}
            {isAdding && (
              <form
                onSubmit={handleQuickAdd}
                className="mb-4 p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-3 animate-in fade-in duration-200"
              >
                <input
                  type="text"
                  required
                  placeholder="What intention needs to be secured?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="flex-1 min-w-[150px] bg-[#121214] border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500/50 [color-scheme:dark]"
                  />

                  {/* Recurrence Dropdown Preset Selector */}
                  <select
                    value={newRecurrenceType}
                    onChange={(e) => setNewRecurrenceType(e.target.value as RecurrencePreset)}
                    className="bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500/50 cursor-pointer [color-scheme:dark]"
                    title="Set recurrence rule"
                  >
                    <option value="never">Never</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                    <option value="weekends">Weekends (Sat-Sun)</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="every_3_months">Every 3 Months</option>
                    <option value="every_6_months">Every 6 Months</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom...</option>
                  </select>

                  {/* Priority Flag Toggle Button */}
                  <button
                    type="button"
                    onClick={() => setNewIsFlagged(!newIsFlagged)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] border transition-all ${
                      newIsFlagged
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Flag className={`w-3 h-3 ${newIsFlagged ? 'fill-amber-400 text-amber-400' : ''}`} />
                    <span>Priority</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting || !newTitle.trim()}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors ml-auto"
                  >
                    {isSubmitting ? 'Saving...' : 'Add'}
                  </button>
                </div>

                {/* iPhone-Style "Custom..." Slide-out Drawer */}
                {newRecurrenceType === 'custom' && (
                  <div className="p-3 rounded-xl bg-[#0a0a0c] border border-indigo-500/30 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200 shadow-inner">
                    <div className="flex items-center justify-between text-[11px] text-indigo-300 font-mono">
                      <span className="flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5" />
                        Custom Recurrence
                      </span>
                      <span className="text-[10px] text-indigo-400 font-medium">
                        {getRecurrenceLabel({
                          type: 'custom',
                          customFrequency: newCustomFrequency,
                          customInterval: newCustomInterval,
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-slate-400 font-mono">Every</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={newCustomInterval}
                        onChange={(e) =>
                          setNewCustomInterval(Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="w-16 bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1 text-center text-xs text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                      />
                      <select
                        value={newCustomFrequency}
                        onChange={(e) => setNewCustomFrequency(e.target.value as CustomFrequency)}
                        className="bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-slate-300 outline-none focus:border-indigo-500/50 cursor-pointer [color-scheme:dark]"
                      >
                        <option value="hourly">{newCustomInterval === 1 ? 'Hour' : 'Hours'}</option>
                        <option value="daily">{newCustomInterval === 1 ? 'Day' : 'Days'}</option>
                        <option value="weekly">{newCustomInterval === 1 ? 'Week' : 'Weeks'}</option>
                        <option value="monthly">{newCustomInterval === 1 ? 'Month' : 'Months'}</option>
                        <option value="yearly">{newCustomInterval === 1 ? 'Year' : 'Years'}</option>
                      </select>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* Inline Editing Form with iPhone-Style Recurrence Picker */}
            {editingId && (
              <form
                onSubmit={handleSaveEdit}
                className="mb-4 p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-3 animate-in fade-in duration-200"
              >
                <div className="flex items-center justify-between text-[11px] text-indigo-300 font-mono">
                  <span>Edit Reminder</span>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="flex-1 min-w-[150px] bg-[#121214] border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500/50 [color-scheme:dark]"
                  />

                  <select
                    value={editRecurrenceType}
                    onChange={(e) => setEditRecurrenceType(e.target.value as RecurrencePreset)}
                    className="bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500/50 cursor-pointer [color-scheme:dark]"
                  >
                    <option value="never">Never</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                    <option value="weekends">Weekends (Sat-Sun)</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="every_3_months">Every 3 Months</option>
                    <option value="every_6_months">Every 6 Months</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom...</option>
                  </select>

                  <button
                    type="submit"
                    disabled={isUpdating || !editTitle.trim()}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors ml-auto"
                  >
                    {isUpdating ? 'Saving...' : 'Update'}
                  </button>
                </div>

                {/* Edit Custom Drawer */}
                {editRecurrenceType === 'custom' && (
                  <div className="p-3 rounded-xl bg-[#0a0a0c] border border-indigo-500/30 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-center justify-between text-[11px] text-indigo-300 font-mono">
                      <span>Custom Recurrence Interval</span>
                      <span className="text-[10px] text-indigo-400">
                        {getRecurrenceLabel({
                          type: 'custom',
                          customFrequency: editCustomFrequency,
                          customInterval: editCustomInterval,
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-slate-400 font-mono">Every</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={editCustomInterval}
                        onChange={(e) =>
                          setEditCustomInterval(Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="w-16 bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1 text-center text-xs text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                      />
                      <select
                        value={editCustomFrequency}
                        onChange={(e) => setEditCustomFrequency(e.target.value as CustomFrequency)}
                        className="bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-slate-300 outline-none focus:border-indigo-500/50 cursor-pointer [color-scheme:dark]"
                      >
                        <option value="hourly">{editCustomInterval === 1 ? 'Hour' : 'Hours'}</option>
                        <option value="daily">{editCustomInterval === 1 ? 'Day' : 'Days'}</option>
                        <option value="weekly">{editCustomInterval === 1 ? 'Week' : 'Weeks'}</option>
                        <option value="monthly">{editCustomInterval === 1 ? 'Month' : 'Months'}</option>
                        <option value="yearly">{editCustomInterval === 1 ? 'Year' : 'Years'}</option>
                      </select>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* Reminders List (Present or Future) */}
            <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1 custom-scrollbar">
              {loading ? (
                <div className="py-8 text-center text-xs font-mono text-slate-500 animate-pulse">
                  Scanning vault reminders...
                </div>
              ) : displayedReminders.length === 0 ? (
                <div className="py-8 px-4 text-center">
                  <Sparkles className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {activeTab === 'present'
                      ? 'No active reminders scheduled for today.'
                      : 'No upcoming future reminders beyond today.'}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Add intentions above, in your journal reflections, or tell Guhan in chat!
                  </p>
                </div>
              ) : (
                displayedReminders.map((item) => {
                  const isRecurring = item.recurrence && item.recurrence.type !== 'never';
                  const recurrenceTooltip = getRecurrenceLabel(item.recurrence);

                  return (
                    <div
                      key={item.id}
                      className={`group relative flex items-center justify-between gap-3 p-3 rounded-xl border transition-all duration-200 ${
                        item.isFlagged
                          ? 'bg-amber-950/20 border-amber-500/40 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)]'
                          : 'bg-white/5 border-white/10 hover:border-indigo-500/40 text-slate-200'
                      }`}
                    >
                      {/* Mark as Complete Checkbox */}
                      <button
                        type="button"
                        onClick={() => handleToggleComplete(item)}
                        className="shrink-0 text-slate-400 hover:text-emerald-400 transition-colors"
                        title={
                          isRecurring
                            ? 'Mark as Complete (archives this instance and rolls forward the next)'
                            : 'Mark as Complete (moves to History)'
                        }
                      >
                        <Circle className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
                      </button>

                      {/* Reminder Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium truncate">{item.Title}</p>

                          {/* Subtle Repeat Indicator with Rule Tooltip */}
                          {isRecurring && (
                            <span
                              className="shrink-0 flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 cursor-help transition-all hover:bg-indigo-500/25"
                              title={recurrenceTooltip}
                            >
                              <RefreshCw className="w-2.5 h-2.5 animate-[spin_10s_linear_infinite]" />
                              <span className="capitalize">
                                {item.recurrence.type === 'custom'
                                  ? `${item.recurrence.customInterval}${item.recurrence.customFrequency?.[0]}`
                                  : item.recurrence.type.replace(/_/g, ' ')}
                              </span>
                            </span>
                          )}

                          {item.isFlagged && (
                            <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Priority
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                          <span
                            className={`font-mono ${
                              item.isFlagged ? 'text-amber-300 font-medium' : 'text-indigo-400'
                            }`}
                          >
                            {formatScheduledDisplay(item.Scheduled_Date)}
                          </span>
                        </div>
                      </div>

                      {/* Hover Actions: Flag, Edit, Delete */}
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {/* Priority Flag Toggle */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleFlag(item, e)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            item.isFlagged
                              ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10'
                              : 'text-slate-500 hover:text-amber-400 hover:bg-white/5'
                          }`}
                          title={item.isFlagged ? 'Unflag priority' : 'Flag as priority'}
                        >
                          <Flag
                            className={`w-3.5 h-3.5 ${
                              item.isFlagged ? 'fill-amber-400 text-amber-400' : ''
                            }`}
                          />
                        </button>

                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={(e) => startEdit(item, e)}
                          className="p-1.5 text-slate-500 hover:text-indigo-300 rounded-lg hover:bg-white/5 transition-colors"
                          title="Edit reminder"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(item, e)}
                          className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                          title="Remove reminder"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer Meta */}
      <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>Zero-Trust Vault</span>
        <span>
          {showHistory
            ? `${completedReminders.length} archived`
            : `${presentReminders.length} today • ${futureReminders.length} upcoming`}
        </span>
      </div>

      {/* Deletion Confirmation Dialog (Single vs Cascade Future) */}
      {deleteTarget && (
        <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md rounded-2xl p-5 flex flex-col justify-center animate-in fade-in duration-150 border border-white/10">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <h4 className="text-xs font-semibold uppercase tracking-wider font-mono">
              Recurring Reminder
            </h4>
          </div>
          <p className="text-xs text-slate-300 mb-1 font-medium line-clamp-1">
            &quot;{deleteTarget.Title}&quot;
          </p>
          <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
            {getRecurrenceLabel(deleteTarget.recurrence)}. Would you like to delete only this instance, or cancel all future recurring instances?
          </p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => executeDeleteSingle(deleteTarget.id)}
              className="w-full py-2 px-3 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 font-medium transition-colors text-left flex items-center justify-between"
            >
              <span>Delete only this instance</span>
              <span className="text-[10px] text-slate-500 font-mono">Single</span>
            </button>

            <button
              type="button"
              onClick={() => executeDeleteAllFuture(deleteTarget)}
              className="w-full py-2 px-3 rounded-lg text-xs bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 font-medium transition-colors text-left flex items-center justify-between"
            >
              <span>Delete all future recurring instances</span>
              <span className="text-[10px] text-red-400 font-mono">Cascade</span>
            </button>

            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="w-full py-1.5 text-center text-xs text-slate-400 hover:text-white transition-colors mt-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
