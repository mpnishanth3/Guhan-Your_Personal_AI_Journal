'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, deleteUser } from 'firebase/auth';
import { collection, query, orderBy, limit, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp, arrayRemove, arrayUnion, increment, writeBatch, where, setDoc } from 'firebase/firestore';
import { eradicateUserData } from '@/lib/account';
import { Navigation } from '@/components/navigation';
import { format, subDays, isSameDay, parseISO } from 'date-fns';
import { Loader2, Zap, BrainCircuit, CheckSquare, Search, Plus, Pencil, Trash2, X, Calendar, BookOpen, ListFilter, Download, Sparkles, CheckCircle2, CheckCircle, AlertCircle, FileSpreadsheet, Mic, Film, Image as ImageIcon, Lock, Unlock, RotateCcw, AlertTriangle, Archive, History, Eye, EyeOff } from 'lucide-react';
import { JournalCalendar } from '@/components/JournalCalendar';
import { MonthlyBarChart } from '@/components/MonthlyBarChart';
import { YearlyStatsWidgets } from '@/components/YearlyStatsWidgets';
import { MoodTrajectoryChart } from '@/components/MoodTrajectoryChart';
import { ReminderWidget } from '@/components/ReminderWidget';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { validateBulkImportCSV, serializeVaultEntriesToCSV } from '@/lib/csv';
import { useBackgroundProcess } from '@/context/BackgroundProcessContext';
import { getEntryLockStatus, getEntryLogicalDate, getEntryCreatedDate, isImportBatchRevertible } from '@/lib/immutability';
import { MediaAttachment } from '@/components/MediaAttachment';
import { getManualMoodLabel } from '@/lib/utils';
import { UntangledTasks, parseCognitiveTask, COGNITIVE_LOAD_STYLES } from '@/components/UntangledTasks';


export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const [tasks, setTasks] = useState<any[]>([]);
  const [completedDashboardTasks, setCompletedDashboardTasks] = useState<any[]>([]);
  const [showDashboardHistory, setShowDashboardHistory] = useState<boolean>(false);
  const [isClearingDashboardTasks, setIsClearingDashboardTasks] = useState<boolean>(false);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState('');
  const [weeklyAnchor, setWeeklyAnchor] = useState<any | null>(null);
  const [isSynthesizingAnchor, setIsSynthesizingAnchor] = useState(false);

  // CRUD Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form states
  const [newPrompt, setNewPrompt] = useState('');
  const [newDate, setNewDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [newManualMood, setNewManualMood] = useState<number | null>(7);
  const [editPrompt, setEditPrompt] = useState('');
  const [editDate, setEditDate] = useState<string>('');
  const [editManualMood, setEditManualMood] = useState<number | null>(7);

  // Calendar View states
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [listDateFilter, setListDateFilter] = useState<string>('');
  const [mediaOnlyFilter, setMediaOnlyFilter] = useState<boolean>(false);

  // Yearly data selection
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());

  // Bulk CSV Import & Global Background Processing
  const rawFileInputRef = useRef<HTMLInputElement>(null);
  const { isImporting, startBulkImport } = useBackgroundProcess();
  const [latestBatchId, setLatestBatchId] = useState<string | null>(null);
  const [showRevertConfirmModal, setShowRevertConfirmModal] = useState<boolean>(false);
  const [isReverting, setIsReverting] = useState(false);

  // Account & Vault Eradication State
  const [isEradicateModalOpen, setIsEradicateModalOpen] = useState(false);
  const [eradicateInput, setEradicateInput] = useState('');
  const [isEradicating, setIsEradicating] = useState(false);

  // Sync latest batch ID from localStorage & events
  useEffect(() => {
    if (!user) return;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`guhan_latest_import_batch_${user.uid}`);
      if (stored) setLatestBatchId(stored);
    }

    const handleBatchEvent = (e: any) => {
      const bId = e.detail?.batchId;
      if (bId) {
        setLatestBatchId(bId);
      } else if (user && typeof window !== 'undefined') {
        const latest = localStorage.getItem(`guhan_latest_import_batch_${user.uid}`);
        if (latest) setLatestBatchId(latest);
      }
    };

    window.addEventListener('guhan:batch-import-started', handleBatchEvent);
    window.addEventListener('guhan:entry-saved', handleBatchEvent);
    return () => {
      window.removeEventListener('guhan:batch-import-started', handleBatchEvent);
      window.removeEventListener('guhan:entry-saved', handleBatchEvent);
    };
  }, [user]);

  // Revert Import Batch state
  const [revertingBatch, setRevertingBatch] = useState<{
    batchId: string;
    count: number;
    createdAt: Date | null;
    sampleDate: string;
  } | null>(null);

  // Date-Ranged Export modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFromDate, setExportFromDate] = useState<string>(() =>
    format(subDays(new Date(), 30), 'yyyy-MM-dd')
  );
  const [exportToDate, setExportToDate] = useState<string>(() =>
    format(new Date(), 'yyyy-MM-dd')
  );
  const [exportError, setExportError] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);

  // Toast Notification state
  const [toast, setToast] = useState<{
    id: string;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  } | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    const id = Date.now().toString();
    setToast({ id, type, title, message });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 5000);
  };

  const router = useRouter();

  // Compute recent eligible import batches (under 7 days old)
  const recentImportBatches = useMemo(() => {
    const map: Record<string, { batchId: string; entries: any[]; createdAt: Date | null }> = {};

    entries.forEach((e) => {
      const bId = e.Import_Batch_ID || e.import_batch_id;
      if (bId) {
        if (!map[bId]) {
          map[bId] = {
            batchId: bId,
            entries: [],
            createdAt: getEntryCreatedDate(e),
          };
        }
        map[bId].entries.push(e);
      }
    });

    return Object.values(map).filter((b) => isImportBatchRevertible(b.createdAt));
  }, [entries]);

  // Compute effective batch ID to revert
  const effectiveRevertBatchId = useMemo(() => {
    if (latestBatchId) return latestBatchId;
    if (user && typeof window !== 'undefined') {
      const stored = localStorage.getItem(`guhan_latest_import_batch_${user.uid}`);
      if (stored) return stored;
    }
    if (recentImportBatches.length > 0) {
      return recentImportBatches[0].batchId;
    }
    return null;
  }, [latestBatchId, user, recentImportBatches]);

  // Compute available years from entries
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearsSet = new Set<number>([currentYear]);

    entries.forEach((e) => {
      const logicalDateStr = e.Entry_Date || e.entry_date;
      if (logicalDateStr) {
        try {
          const yr = parseISO(logicalDateStr).getFullYear();
          if (!isNaN(yr)) yearsSet.add(yr);
        } catch { }
      } else if (e.Created_At?.toDate) {
        const yr = e.Created_At.toDate().getFullYear();
        if (!isNaN(yr)) yearsSet.add(yr);
      } else if (e.createdAt?.toDate) {
        const yr = e.createdAt.toDate().getFullYear();
        if (!isNaN(yr)) yearsSet.add(yr);
      }
    });

    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [entries]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push('/');
      } else {
        setUser(currentUser);
        await fetchDashboardData(currentUser.uid);
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Listen for global background entry completions to refresh dashboard metrics automatically
  useEffect(() => {
    const handleEntrySaved = () => {
      if (user?.uid) {
        fetchDashboardData(user.uid);
      }
    };

    window.addEventListener('guhan:entry-saved', handleEntrySaved);
    return () => {
      window.removeEventListener('guhan:entry-saved', handleEntrySaved);
    };
  }, [user?.uid]);

  const fetchDashboardData = async (uid: string) => {
    try {
      const q = query(collection(db, 'users', uid, 'entries'), orderBy('createdAt', 'desc'), limit(500));
      const querySnapshot = await getDocs(q);

      const loadedEntries: any[] = [];
      querySnapshot.forEach((doc) => {
        loadedEntries.push({ id: doc.id, ...doc.data() });
      });

      setEntries(loadedEntries);
      calculateMetrics(loadedEntries);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateMetrics = (data: any[]) => {
    // Collect unique active and completed tasks with entry linkage (support both array and semicolon-delimited string formats)
    const allTasks: { raw: string; entryId: string; entryDate: string }[] = [];
    const allCompleted: { raw: string; entryId: string; entryDate: string }[] = [];

    data.forEach((entry) => {
      const taskField = entry.Actionable_Tasks ?? entry.actionable_tasks;
      const completedField =
        entry.Completed_Tasks ?? entry.completed_tasks ?? entry.Discarded_Tasks ?? entry.discarded_tasks;
      const dateStr = getEntryLogicalDate(entry);

      if (taskField) {
        if (Array.isArray(taskField)) {
          taskField.forEach((t: string) => {
            if (t && typeof t === 'string' && t.trim()) {
              allTasks.push({ raw: t.trim(), entryId: entry.id, entryDate: dateStr });
            }
          });
        } else if (typeof taskField === 'string' && taskField.trim()) {
          const parsed = taskField
            .split(';')
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);
          parsed.forEach((t: string) => {
            allTasks.push({ raw: t, entryId: entry.id, entryDate: dateStr });
          });
        }
      }

      if (completedField) {
        if (Array.isArray(completedField)) {
          completedField.forEach((t: string) => {
            if (t && typeof t === 'string' && t.trim()) {
              allCompleted.push({ raw: t.trim(), entryId: entry.id, entryDate: dateStr });
            }
          });
        } else if (typeof completedField === 'string' && completedField.trim()) {
          const parsed = completedField
            .split(';')
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);
          parsed.forEach((t: string) => {
            allCompleted.push({ raw: t, entryId: entry.id, entryDate: dateStr });
          });
        }
      }
    });

    setTasks(allTasks.slice(0, 12)); // Keep top 12 recent tasks
    setCompletedDashboardTasks(allCompleted.slice(0, 12)); // Keep top 12 recent completed history tasks

    // Calculate Streak
    if (data.length === 0) {
      setStreak(0);
      return;
    }

    let currentStreak = 0;
    let currentDate = new Date();
    let entryIndex = 0;

    // Check if they posted today
    const firstEntryDate = data[0].createdAt?.toDate() || new Date();
    if (!isSameDay(firstEntryDate, currentDate) && !isSameDay(firstEntryDate, subDays(currentDate, 1))) {
      setStreak(0);
      return;
    }

    // Basic consecutive day counter
    let dateToCheck = firstEntryDate;
    while (entryIndex < data.length) {
      const entryDate = data[entryIndex].createdAt?.toDate();
      if (!entryDate) {
        entryIndex++;
        continue;
      }

      if (isSameDay(entryDate, dateToCheck)) {
        currentStreak++;
        dateToCheck = subDays(dateToCheck, 1);

        // Skip all other entries from the same day
        while (entryIndex < data.length && isSameDay(data[entryIndex].createdAt?.toDate(), entryDate)) {
          entryIndex++;
        }
      } else if (entryDate < dateToCheck) {
        break; // Streak broken
      } else {
        entryIndex++;
      }
    }

    setStreak(currentStreak);
  };

  // Synchronize entry updates (e.g. archiving/restoring tasks) across entries and dashboard metrics
  const handleEntryUpdated = (updatedEntry: any) => {
    setEntries((prev) => {
      const newEntries = prev.map((e) => (e.id === updatedEntry.id ? updatedEntry : e));
      calculateMetrics(newEntries);
      return newEntries;
    });
  };

  const handleCompleteDashboardTask = async (taskItem: any) => {
    if (!user?.uid) return;
    const raw = typeof taskItem === 'string' ? taskItem : taskItem.raw;
    const entryId = typeof taskItem === 'object' ? taskItem.entryId : undefined;
    if (!raw || !entryId) return;

    // Optimistically remove from dashboard active tasks and append to completed history
    setTasks((prev) => prev.filter((t) => (typeof t === 'string' ? t !== raw : t.raw !== raw)));
    const targetEntry = entries.find((e) => e.id === entryId);
    const dateStr = targetEntry ? getEntryLogicalDate(targetEntry) : '';
    setCompletedDashboardTasks((prev) => [{ raw, entryId, entryDate: dateStr }, ...prev]);

    // Optimistically update entry in local entries state
    setEntries((prevEntries) =>
      prevEntries.map((e) => {
        if (e.id !== entryId) return e;
        const currentActive = Array.isArray(e.Actionable_Tasks ?? e.actionable_tasks)
          ? (e.Actionable_Tasks ?? e.actionable_tasks)
          : [];
        const currentCompleted = Array.isArray(
          e.Completed_Tasks ?? e.completed_tasks ?? e.Discarded_Tasks ?? e.discarded_tasks
        )
          ? (e.Completed_Tasks ?? e.completed_tasks ?? e.Discarded_Tasks ?? e.discarded_tasks)
          : [];
        const newActive = currentActive.filter((t: string) => t !== raw);
        const newCompleted = [raw, ...currentCompleted];
        return {
          ...e,
          Actionable_Tasks: newActive,
          actionable_tasks: newActive,
          Completed_Tasks: newCompleted,
          completed_tasks: newCompleted,
        };
      })
    );

    try {
      const entryRef = doc(db, 'users', user.uid, 'entries', entryId);
      try {
        await updateDoc(entryRef, {
          Actionable_Tasks: arrayRemove(raw),
          Completed_Tasks: arrayUnion(raw),
          actionable_tasks: arrayRemove(raw),
          completed_tasks: arrayUnion(raw),
          updatedAt: serverTimestamp(),
        });
      } catch (atomicErr) {
        const targetEntry = entries.find((e) => e.id === entryId);
        const currentActive = Array.isArray(targetEntry?.Actionable_Tasks ?? targetEntry?.actionable_tasks)
          ? (targetEntry?.Actionable_Tasks ?? targetEntry?.actionable_tasks)
          : [];
        const currentCompleted = Array.isArray(
          targetEntry?.Completed_Tasks ??
            targetEntry?.completed_tasks ??
            targetEntry?.Discarded_Tasks ??
            targetEntry?.discarded_tasks
        )
          ? (targetEntry?.Completed_Tasks ??
              targetEntry?.completed_tasks ??
              targetEntry?.Discarded_Tasks ??
              targetEntry?.discarded_tasks)
          : [];
        const newActive = currentActive.filter((t: string) => t !== raw);
        const newCompleted = [raw, ...currentCompleted];
        await updateDoc(entryRef, {
          Actionable_Tasks: newActive,
          Completed_Tasks: newCompleted,
          actionable_tasks: newActive,
          completed_tasks: newCompleted,
          updatedAt: serverTimestamp(),
        });
      }
      showToast('success', 'Task Completed', 'Insight resolved and saved to completed history.');
    } catch (err) {
      console.error('Failed to complete dashboard task:', err);
      fetchDashboardData(user.uid);
    }
  };

  const handleRestoreDashboardTask = async (taskItem: any) => {
    if (!user?.uid) return;
    const raw = typeof taskItem === 'string' ? taskItem : taskItem.raw;
    const entryId = typeof taskItem === 'object' ? taskItem.entryId : undefined;
    if (!raw || !entryId) return;

    // Optimistically remove from completed history and append to active tasks
    setCompletedDashboardTasks((prev) => prev.filter((t) => (typeof t === 'string' ? t !== raw : t.raw !== raw)));
    const targetEntry = entries.find((e) => e.id === entryId);
    const dateStr = targetEntry ? getEntryLogicalDate(targetEntry) : '';
    setTasks((prev) => [...prev, { raw, entryId, entryDate: dateStr }]);

    // Optimistically update entry in local entries state
    setEntries((prevEntries) =>
      prevEntries.map((e) => {
        if (e.id !== entryId) return e;
        const currentActive = Array.isArray(e.Actionable_Tasks ?? e.actionable_tasks)
          ? (e.Actionable_Tasks ?? e.actionable_tasks)
          : [];
        const currentCompleted = Array.isArray(
          e.Completed_Tasks ?? e.completed_tasks ?? e.Discarded_Tasks ?? e.discarded_tasks
        )
          ? (e.Completed_Tasks ?? e.completed_tasks ?? e.Discarded_Tasks ?? e.discarded_tasks)
          : [];
        const newCompleted = currentCompleted.filter((t: string) => t !== raw);
        const newActive = [...currentActive, raw];
        return {
          ...e,
          Actionable_Tasks: newActive,
          actionable_tasks: newActive,
          Completed_Tasks: newCompleted,
          completed_tasks: newCompleted,
        };
      })
    );

    try {
      const entryRef = doc(db, 'users', user.uid, 'entries', entryId);
      try {
        await updateDoc(entryRef, {
          Completed_Tasks: arrayRemove(raw),
          Actionable_Tasks: arrayUnion(raw),
          completed_tasks: arrayRemove(raw),
          actionable_tasks: arrayUnion(raw),
          updatedAt: serverTimestamp(),
        });
      } catch (atomicErr) {
        const currentActive = Array.isArray(targetEntry?.Actionable_Tasks ?? targetEntry?.actionable_tasks)
          ? (targetEntry?.Actionable_Tasks ?? targetEntry?.actionable_tasks)
          : [];
        const currentCompleted = Array.isArray(
          targetEntry?.Completed_Tasks ??
            targetEntry?.completed_tasks ??
            targetEntry?.Discarded_Tasks ??
            targetEntry?.discarded_tasks
        )
          ? (targetEntry?.Completed_Tasks ??
              targetEntry?.completed_tasks ??
              targetEntry?.Discarded_Tasks ??
              targetEntry?.discarded_tasks)
          : [];
        const newCompleted = currentCompleted.filter((t: string) => t !== raw);
        const newActive = [...currentActive, raw];
        await updateDoc(entryRef, {
          Actionable_Tasks: newActive,
          Completed_Tasks: newCompleted,
          actionable_tasks: newActive,
          completed_tasks: newCompleted,
          updatedAt: serverTimestamp(),
        });
      }
      showToast('success', 'Task Restored', 'Insight restored to active priorities.');
    } catch (err) {
      console.error('Failed to restore dashboard task:', err);
      fetchDashboardData(user.uid);
    }
  };

  const handleClearCompletedDashboardTasks = async () => {
    if (!user?.uid || isClearingDashboardTasks || completedDashboardTasks.length === 0) return;
    setIsClearingDashboardTasks(true);

    // Group items to clear by entryId
    const entryTaskMap = new Map<string, number>();
    completedDashboardTasks.forEach((item) => {
      const eid = typeof item === 'object' ? item.entryId : undefined;
      if (eid) {
        entryTaskMap.set(eid, (entryTaskMap.get(eid) || 0) + 1);
      }
    });

    const prevCompleted = [...completedDashboardTasks];
    setCompletedDashboardTasks([]);

    try {
      // Execute clear transaction per entry
      const promises: Promise<any>[] = [];
      entryTaskMap.forEach((count, entryId) => {
        const entryRef = doc(db, 'users', user.uid, 'entries', entryId);
        promises.push(
          updateDoc(entryRef, {
            Completed_Tasks: [],
            completed_tasks: [],
            Discarded_Tasks: [],
            discarded_tasks: [],
            Archived_Task_Count: increment(count),
            archived_task_count: increment(count),
            updatedAt: serverTimestamp(),
          })
        );
      });

      await Promise.all(promises);

      // Update local entries state with incremented Archived_Task_Count
      setEntries((prevEntries) =>
        prevEntries.map((e) => {
          if (!entryTaskMap.has(e.id)) return e;
          const count = entryTaskMap.get(e.id) || 0;
          const currentArchived = Number(e.Archived_Task_Count ?? e.archived_task_count ?? 0) || 0;
          return {
            ...e,
            Completed_Tasks: [],
            completed_tasks: [],
            Discarded_Tasks: [],
            discarded_tasks: [],
            Archived_Task_Count: currentArchived + count,
            archived_task_count: currentArchived + count,
          };
        })
      );

      showToast('success', 'History Cleared', 'Completed tasks cleared. Analytics throughput permanently preserved.');
    } catch (err) {
      console.error('Failed to clear completed dashboard tasks:', err);
      setCompletedDashboardTasks(prevCompleted);
      showToast('error', 'Error', 'Failed to clear completed tasks.');
      fetchDashboardData(user.uid);
    } finally {
      setIsClearingDashboardTasks(false);
    }
  };

  // Chat Speech-to-Text Voice Dictation
  const {
    isListening: isChatListening,
    isSupported: isChatSpeechSupported,
    toggleListening: toggleChatListening,
  } = useSpeechRecognition({
    onTranscriptAppend: (text) => {
      setChatInput((prev) => {
        if (!prev) return text;
        const separator = /\s$/.test(prev) ? '' : ' ';
        return `${prev}${separator}${text}`;
      });
    },
    onErrorToast: (msg) => {
      showToast('error', 'Voice Dictation', msg);
    },
  });

  // Proactive Weekly Synthesis: Generate or Renew Weekly Cognitive Anchor
  const synthesizeWeeklyAnchor = async (force = false) => {
    if (!user || isSynthesizingAnchor) return;
    setIsSynthesizingAnchor(true);
    try {
      const recentList = entries.slice(0, 15).map((e) => ({
        date: getEntryLogicalDate(e),
        mood_score: e.Mood_Score ?? e.mood_score,
        text: e.original_prompt || e.scrubbed_text || '',
        tasks: e.Actionable_Tasks ?? e.actionable_tasks,
      }));

      const res = await fetch('/api/synthesize-weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          clientDate: new Date().toISOString().split('T')[0],
          recentEntries: recentList,
        }),
      });

      const data = await res.json();
      if (data.success && data.synthesis) {
        const docRef = doc(db, 'users', user.uid, 'weekly_synthesis', data.synthesis.weekId);
        await setDoc(docRef, data.synthesis, { merge: true });
        setWeeklyAnchor(data.synthesis);
        if (force) {
          showToast('success', 'Cognitive Anchor Renewed', 'Your weekly anchor has been synthesized.');
        }
      }
    } catch (err) {
      console.warn('Weekly synthesis generation notice:', err);
    } finally {
      setIsSynthesizingAnchor(false);
    }
  };

  // Proactive Weekly Synthesis: Fetch latest document and check if renewal needed
  useEffect(() => {
    if (!user) return;
    const checkAndFetchWeeklyAnchor = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'weekly_synthesis'),
          orderBy('date', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const docData = snap.docs[0].data();
          setWeeklyAnchor({ id: snap.docs[0].id, ...docData });

          if (docData.date) {
            const anchorDate = new Date(docData.date).getTime();
            const now = Date.now();
            const diffDays = (now - anchorDate) / (1000 * 60 * 60 * 24);
            if (diffDays >= 7 && entries.length > 0) {
              synthesizeWeeklyAnchor(false);
            }
          }
        } else if (entries.length > 0) {
          synthesizeWeeklyAnchor(false);
        }
      } catch (err) {
        console.warn('Notice: weekly_synthesis query:', err);
      }
    };
    checkAndFetchWeeklyAnchor();
  }, [user, entries.length]);

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !user) return;

    setIsChatting(true);
    setChatError('');
    setChatResponse('');

    try {
      // Format context for Semantic Search & RAG
      const contextEntries = entries.slice(0, 30).map(e => ({
        date: e.entry_date || (e.createdAt?.toDate()?.toLocaleDateString()) || 'Unknown Date',
        mood_score: e.mood_score,
        original_prompt: e.original_prompt,
        scrubbed_text: e.scrubbed_text,
        actionable_tasks: e.actionable_tasks || e.Actionable_Tasks,
        embedding: e.embedding,
      }));

      const now = new Date();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const offsetMinutes = -now.getTimezoneOffset();
      const offsetSign = offsetMinutes >= 0 ? '+' : '-';
      const absOffset = Math.abs(offsetMinutes);
      const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
      const offsetMins = String(absOffset % 60).padStart(2, '0');
      const timeZoneOffset = `${offsetSign}${offsetHours}:${offsetMins}`;

      const pad = (n: number) => String(n).padStart(2, '0');
      const clientLocalTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const clientDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: chatInput,
          userId: user.uid,
          contextEntries,
          clientTime: now.toISOString(),
          clientLocalTime,
          clientDate,
          timeZone,
          timeZoneOffset,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to chat');

      setChatResponse(data.text);

      // If a natural language reminder was parsed, save to users/{userId}/reminders
      if (data.isReminder && data.reminder) {
        try {
          const recObj =
            typeof data.reminder.recurrence === 'object' && data.reminder.recurrence
              ? data.reminder.recurrence
              : { type: typeof data.reminder.recurrence === 'string' && data.reminder.recurrence !== 'none' ? data.reminder.recurrence : 'never' };
          const isRec = recObj.type && recObj.type !== 'never';
          const seriesId = isRec
            ? `series_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
            : null;

          await addDoc(collection(db, 'users', user.uid, 'reminders'), {
            Title: data.reminder.title,
            Scheduled_Date: data.reminder.scheduled_time,
            Scheduled_Time: data.reminder.scheduled_time,
            isCompleted: false,
            isFlagged: false,
            recurrence: recObj,
            seriesId: seriesId,
            Status: 'pending',
            Timestamp: new Date().toISOString(),
          });
          const recNote = isRec ? ` (${recObj.type} repeat)` : '';
          showToast(
            'success',
            'Vault Reminder Secured',
            `"${data.reminder.title}"${recNote} has been saved to your sanctuary reminders.`
          );
        } catch (remErr) {
          console.error('Error saving chat reminder to vault:', remErr);
        }
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setChatError('Could not communicate with the reflection assistant.');
    } finally {
      setIsChatting(false);
    }
  };

  // Handle Add Entry from Dashboard
  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrompt.trim() || !user || !newDate) return;
    setIsSaving(true);
    try {
      const response = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt, userId: user.uid }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to process journal entry.');

      const savePayload = {
        userId: user.uid,
        Entry_Date: newDate,
        entry_date: newDate,
        original_prompt: newPrompt,
        scrubbed_text: data.scrubbed_text,
        mood_score: data.analysis.mood_score,
        Mood_Score: data.analysis.mood_score,
        manual_mood_score: newManualMood !== null ? Number(newManualMood) : null,
        Manual_Mood_Score: newManualMood !== null ? Number(newManualMood) : null,
        actionable_tasks: Array.isArray(data.analysis?.actionable_tasks) && data.analysis.actionable_tasks.length > 0
          ? data.analysis.actionable_tasks
          : null,
        Actionable_Tasks: Array.isArray(data.analysis?.actionable_tasks) && data.analysis.actionable_tasks.length > 0
          ? data.analysis.actionable_tasks
          : null,
        Completed_Tasks: [],
        completed_tasks: [],
        Archived_Task_Count: 0,
        archived_task_count: 0,
        discarded_tasks: [],
        Discarded_Tasks: [],
        response_text: data.analysis.response_text,
        Created_At: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'users', user.uid, 'entries'), savePayload);
      setNewPrompt('');
      setNewManualMood(7);
      setIsAddModalOpen(false);
      await fetchDashboardData(user.uid);
    } catch (err: any) {
      console.error('Error creating entry:', err);
      alert(err.message || 'Failed to add entry.');
    } finally {
      setIsSaving(false);
    }
  };

  // Open Edit Modal with 7-day grace period enforcement
  const openEditModal = (entry: any) => {
    const lockStatus = getEntryLockStatus(entry);
    if (lockStatus.isLocked) {
      showToast('error', 'Entry Permanently Sealed', 'This reflection was sealed over 7 days ago and cannot be edited.');
      return;
    }
    setEditingEntry(entry);
    setEditPrompt(entry.original_prompt || entry.scrubbed_text || '');
    setEditDate(getEntryLogicalDate(entry));
    const loadedManual = typeof entry.Manual_Mood_Score === 'number'
      ? entry.Manual_Mood_Score
      : typeof entry.manual_mood_score === 'number'
      ? entry.manual_mood_score
      : null;
    setEditManualMood(loadedManual);
    setIsEditModalOpen(true);
  };

  // Handle Update Entry with 7-day grace period enforcement
  const handleUpdateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || !editPrompt.trim() || !user || !editDate) return;
    const lockStatus = getEntryLockStatus(editingEntry);
    if (lockStatus.isLocked) {
      showToast('error', 'Update Blocked', 'This entry is permanently sealed (7-day grace period expired).');
      return;
    }
    setIsSaving(true);
    try {
      const entryRef = doc(db, 'users', user.uid, 'entries', editingEntry.id);
      await updateDoc(entryRef, {
        original_prompt: editPrompt,
        Entry_Date: editDate,
        entry_date: editDate,
        Manual_Mood_Score: editManualMood !== null ? Number(editManualMood) : null,
        manual_mood_score: editManualMood !== null ? Number(editManualMood) : null,
      });
      setIsEditModalOpen(false);
      setEditingEntry(null);
      await fetchDashboardData(user.uid);
    } catch (err: any) {
      console.error('Error updating entry:', err);
      alert(err.message || 'Failed to update entry.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Delete Entry with 7-day grace period enforcement
  const handleDeleteEntry = async (entryOrId: any) => {
    if (!user) return;
    const entry = typeof entryOrId === 'object' ? entryOrId : entries.find((e) => e.id === entryOrId);
    if (entry) {
      const lockStatus = getEntryLockStatus(entry);
      if (lockStatus.isLocked) {
        showToast('error', 'Deletion Blocked', 'This reflection was sealed over 7 days ago and is permanently immutable.');
        return;
      }
    }
    const entryId = typeof entryOrId === 'object' ? entryOrId.id : entryOrId;
    if (!window.confirm('Are you sure you want to delete this journal entry?')) return;
    setIsDeleting(entryId);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'entries', entryId));
      await fetchDashboardData(user.uid);
    } catch (err: any) {
      console.error('Error deleting entry:', err);
      alert('Failed to delete entry.');
    } finally {
      setIsDeleting(null);
    }
  };

  // Handle Revert / Undo of the Latest Import Batch
  const revertLastImport = async () => {
    if (!user) return;
    const batchId = effectiveRevertBatchId;
    if (!batchId) {
      showToast('error', 'No Import Found', 'No recent import batch found to revert.');
      return;
    }

    setIsReverting(true);
    try {
      const entriesRef = collection(db, 'users', user.uid, 'entries');
      const q1 = query(entriesRef, where('import_batch_id', '==', batchId));
      let snapshot = await getDocs(q1);

      if (snapshot.empty) {
        const q2 = query(entriesRef, where('Import_Batch_ID', '==', batchId));
        snapshot = await getDocs(q2);
      }

      if (!snapshot.empty) {
        const docsToDelete = snapshot.docs;
        for (let i = 0; i < docsToDelete.length; i += 450) {
          const batch = writeBatch(db);
          const chunk = docsToDelete.slice(i, i + 450);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } else {
        // Fallback: match in-memory entries if Firestore query is empty
        const matching = entries.filter(
          (e) => (e.import_batch_id || e.Import_Batch_ID) === batchId
        );
        if (matching.length === 0) {
          showToast('error', 'Batch Not Found', 'No entries found for this import batch.');
          setShowRevertConfirmModal(false);
          setIsReverting(false);
          return;
        }

        for (let i = 0; i < matching.length; i += 450) {
          const batch = writeBatch(db);
          const chunk = matching.slice(i, i + 450);
          chunk.forEach((e) => batch.delete(doc(db, 'users', user.uid, 'entries', e.id)));
          await batch.commit();
        }
      }

      // Clear from localStorage & settings
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`guhan_latest_import_batch_${user.uid}`);
      }
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'settings', 'import_metadata'),
          { latest_import_batch_id: null, reverted_at: serverTimestamp() },
          { merge: true }
        );
      } catch { }

      setLatestBatchId(null);
      setShowRevertConfirmModal(false);

      showToast('success', 'Import Reverted', 'Import reverted. Vault restored to previous state.');
      await fetchDashboardData(user.uid);
      router.refresh();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('guhan:entry-saved', { detail: { isRevert: true } }));
      }
    } catch (err: any) {
      console.error('Error reverting import batch:', err);
      showToast('error', 'Revert Failed', err.message || 'Failed to revert import batch.');
    } finally {
      setIsReverting(false);
    }
  };

  // Total Account & Digital Vault Eradication Routine
  const handleDeleteAccount = async () => {
    if (!user || eradicateInput.trim() !== 'ERADICATE' || isEradicating) return;

    setIsEradicating(true);
    try {
      const currentUser = auth.currentUser;
      const userId = user.uid;

      // 1. Data Eradication (Firestore & Storage & IndexedDB)
      await eradicateUserData(userId);

      // 2. Auth Deletion & Error Handling (requires-recent-login)
      if (currentUser) {
        try {
          await deleteUser(currentUser);
        } catch (authErr: any) {
          console.error('Auth deletion error:', authErr);
          if (
            authErr?.code === 'auth/requires-recent-login' ||
            authErr?.message?.includes('requires-recent-login')
          ) {
            showToast(
              'error',
              'Security Protocol',
              'Security protocol requires a fresh login to delete your account. Please log out, log back in, and try again.'
            );
            setIsEradicating(false);
            setIsEradicateModalOpen(false);
            return;
          }
          throw authErr;
        }
      }

      // 3. Graceful Exit: clear local states, clear local storage, redirect to root /
      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
      }

      showToast('success', 'Vault Eradicated', 'Your digital vault and account have been permanently erased.');
      setIsEradicating(false);
      setIsEradicateModalOpen(false);

      router.push('/');
    } catch (err: any) {
      console.error('Account eradication failed:', err);
      showToast('error', 'Eradication Failed', err?.message || 'Failed to eradicate account. Please try again.');
      setIsEradicating(false);
    }
  };

  // Handle Strict Bulk CSV Ingestion (Date, Content, Manual_Mood) with Background Guhan AI Synthesis
  const handleImportRawCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Reset input so same file can be re-selected if desired
    e.target.value = '';

    try {
      const text = await file.text();
      const result = validateBulkImportCSV(text);

      if (!result.isValid) {
        showToast(
          'error',
          'Invalid format',
          result.errorMessage || 'Invalid format. Required: date, content, manual_mood.'
        );
        return;
      }

      const batchId = startBulkImport(result.rows, user.uid);
      if (batchId) {
        setLatestBatchId(batchId);
      }
      showToast(
        'info',
        'Archive Ingestion Initiated',
        `Securing ${result.rows.length} entries sequentially in the background.`
      );
    } catch (err: any) {
      console.error('CSV Import Pipeline Error:', err);
      showToast(
        'error',
        'Invalid format',
        err?.message || 'Invalid format. Required: date, content, manual_mood.'
      );
    }
  };

  // Handle Date-Ranged Vault Export
  const handleExportVaultCSV = async () => {
    if (!user) return;

    if (!exportFromDate || !exportToDate) {
      setExportError('Please specify both From and To dates.');
      return;
    }

    if (exportFromDate > exportToDate) {
      setExportError('From Date cannot be later than To Date.');
      return;
    }

    setIsExporting(true);
    setExportError('');

    try {
      // Query Firestore for documents matching userId
      const q = query(collection(db, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);

      const matchingEntries: any[] = [];
      querySnapshot.forEach((d) => {
        const data = d.data();
        const entryDate =
          data.entry_date ||
          (data.createdAt?.toDate ? format(data.createdAt.toDate(), 'yyyy-MM-dd') : null);

        if (entryDate && entryDate >= exportFromDate && entryDate <= exportToDate) {
          matchingEntries.push({ id: d.id, ...data });
        }
      });

      if (matchingEntries.length === 0) {
        setExportError('No entries found within the selected time frame.');
        setIsExporting(false);
        return;
      }

      // Serialize matching records with all fields: Date, Context, Mood_Score, Actionable_Tasks, Timestamp, Tags
      const csvContent = serializeVaultEntriesToCSV(matchingEntries);
      const filename = `guhan_vault_export_${exportFromDate}_${exportToDate}.csv`;

      // Trigger automatic browser download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setIsExporting(false);
      setIsExportModalOpen(false);
      showToast(
        'success',
        'Vault Export Complete',
        `Downloaded ${matchingEntries.length} reflections as ${filename}.`
      );
    } catch (err: any) {
      console.error('Vault Export Error:', err);
      setIsExporting(false);
      setExportError(err.message || 'Failed to export entries from vault.');
    }
  };

  if (loading) {
    return (
      <div suppressHydrationWarning className="flex items-center justify-center min-h-screen bg-transparent text-slate-400 font-sans">
        <p className="text-sm font-mono tracking-widest uppercase animate-pulse">Loading Identity Data...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div suppressHydrationWarning className="min-h-screen bg-transparent text-[#e2e8f0] font-sans flex flex-col">
      <Navigation />

      <main className="flex-1 max-w-6xl w-full mx-auto p-8 flex flex-col gap-8">

        {/* Section 1: Aggregated Yearly Stats Widgets */}
        <YearlyStatsWidgets
          entries={entries}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
          availableYears={availableYears}
          currentStreak={streak}
        />

        {/* Section 2: Visual Analytics (Monthly Volume Bar Chart & Mood Trajectory) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Monthly Bar Chart */}
          <div className="lg:col-span-7">
            <MonthlyBarChart
              entries={entries}
              selectedYear={selectedYear}
              onYearChange={setSelectedYear}
              availableYears={availableYears}
              className="h-full"
            />
          </div>

          {/* Right Column: Mood Trajectory Chart (Strict Ascending Chronological Order & Ambient Glow) */}
          <div className="lg:col-span-5">
            <MoodTrajectoryChart entries={entries} className="h-full" />
          </div>
        </div>

        {/* Section 3: AI Assistant & Sanctuary Reminder System */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Chat with Guhan */}
          <div className="lg:col-span-7 bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col justify-between shadow-2xl">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-medium text-slate-200">Chat with Guhan</h3>
                <p className="text-xs text-slate-400">Insights from your history & natural language reminder creation.</p>
              </div>
            </div>

            {/* Proactive Weekly Synthesis: Weekly Cognitive Anchor Card */}
            {weeklyAnchor && (
              <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-xl p-4 mb-4 flex flex-col gap-1.5 shadow-sm">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-mono uppercase tracking-wider font-semibold">
                    Weekly Cognitive Anchor
                  </span>
                  {weeklyAnchor.mood_trend && (
                    <span className="text-[10px] text-indigo-300/70 italic ml-1">
                      &bull; {weeklyAnchor.mood_trend}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {weeklyAnchor.date && (
                      <span className="text-[11px] text-slate-400 font-mono">
                        {weeklyAnchor.date}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => synthesizeWeeklyAnchor(true)}
                      disabled={isSynthesizingAnchor}
                      title="Re-synthesize weekly anchor"
                      className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-white/5 transition-all disabled:opacity-50"
                    >
                      <RotateCcw
                        className={`w-3.5 h-3.5 ${isSynthesizingAnchor ? 'animate-spin text-indigo-400' : ''}`}
                      />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {weeklyAnchor.cognitive_anchor ||
                    weeklyAnchor.summary ||
                    weeklyAnchor.anchor ||
                    weeklyAnchor.content ||
                    'Mindful anchor synthesized from your past week.'}
                </p>
                {weeklyAnchor.theme && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-indigo-300/80 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                      #{weeklyAnchor.theme}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 flex flex-col justify-between">
              {chatResponse ? (
                <div className="flex-1 mb-6 p-5 rounded-xl bg-white/5 border border-white/5 text-sm leading-relaxed text-slate-200">
                  <span className="text-xs font-mono text-purple-400 uppercase tracking-widest block mb-3">
                    Assistant Synthesis
                  </span>
                  {chatResponse}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center mb-6 py-8">
                  <p className="text-sm text-slate-500 text-center max-w-sm leading-relaxed">
                    Ask questions about your journal reflections or say <span className="text-indigo-400 font-mono">&quot;Remind me to review logs tomorrow at 9am&quot;</span>.
                  </p>
                </div>
              )}

              <form onSubmit={handleChat} className="relative">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isChatting}
                  placeholder={
                    isChatListening
                      ? "Listening... Speak your reflection or reminder..."
                      : "e.g. Remind me to check the database at 5 PM..."
                  }
                  className="w-full bg-[#121214] border border-white/10 rounded-xl py-4 pl-4 pr-24 text-sm outline-none focus:border-indigo-500/50 focus:shadow-[0_0_15px_rgba(99,102,241,0.1)] transition-all placeholder:text-slate-600 disabled:opacity-50"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isChatSpeechSupported) {
                        showToast('error', 'Voice Dictation', 'Voice dictation is not supported in this browser.');
                        return;
                      }
                      toggleChatListening();
                    }}
                    disabled={isChatting}
                    className={`p-2 rounded-lg transition-all ${
                      !isChatSpeechSupported
                        ? 'opacity-40 cursor-not-allowed text-slate-600'
                        : isChatListening
                        ? 'text-rose-400 bg-rose-500/20 border border-rose-500/40 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    title={
                      !isChatSpeechSupported
                        ? 'Voice dictation is not supported in this browser'
                        : isChatListening
                        ? 'Stop listening'
                        : 'Voice dictation'
                    }
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={isChatting || !chatInput.trim()}
                    className="p-2 text-slate-400 hover:text-white disabled:opacity-50 transition-colors"
                  >
                    {isChatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                </div>
              </form>
              {chatError && <p className="text-xs text-red-400 mt-2">{chatError}</p>}
            </div>
          </div>

          {/* Right Column: Sanctuary Reminder Widget */}
          <div className="lg:col-span-5 flex flex-col">
            <ReminderWidget userId={user.uid} className="h-full" />
          </div>
        </div>

        {/* Section 3B: Untangled Next Steps (rendered if tasks OR completed history exist) */}
        {(tasks.length > 0 || completedDashboardTasks.length > 0) && (
          <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-200">Untangled Next Steps</h3>
                  <p className="text-xs text-slate-400">Actionable next steps extracted from reflections</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {tasks.length > 0 && (
                  <span className="text-xs font-mono text-slate-400 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                    {tasks.length} active
                  </span>
                )}
                {completedDashboardTasks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDashboardHistory(!showDashboardHistory)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono transition-all duration-200 ${
                      showDashboardHistory
                        ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/10'
                    }`}
                    title={showDashboardHistory ? 'Hide completed insights history' : 'Unhide completed insights history'}
                  >
                    {showDashboardHistory ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-indigo-300" />
                        <span>Hide History ({completedDashboardTasks.length})</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Unhide History ({completedDashboardTasks.length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Active Tasks Grid */}
            {tasks.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {tasks.map((taskItem, idx) => {
                  const raw = typeof taskItem === 'string' ? taskItem : taskItem.raw;
                  const { category, cleanTaskText } = parseCognitiveTask(raw);
                  const styleConfig =
                    COGNITIVE_LOAD_STYLES[category] || COGNITIVE_LOAD_STYLES['Standard'];
                  const entryId = typeof taskItem === 'object' ? taskItem.entryId : undefined;
                  const entryDate = typeof taskItem === 'object' ? taskItem.entryDate : undefined;

                  return (
                    <div
                      key={idx}
                      className={`group relative flex flex-col justify-between gap-2 pl-3.5 pr-3 py-2.5 rounded-r-xl border border-transparent border-t-white/[0.03] border-r-white/[0.03] border-b-white/[0.03] text-sm text-slate-300 transition-all duration-150 hover:bg-white/[0.08] shadow-sm ${styleConfig.card}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-500 tracking-widest font-mono uppercase font-medium">
                          {category}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {entryDate && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCalendarDate(entryDate);
                                setViewMode('calendar');
                              }}
                              className="text-[10px] font-mono text-slate-500 hover:text-indigo-300 transition-colors"
                              title={`Jump to calendar for ${entryDate}`}
                            >
                              {entryDate}
                            </button>
                          )}
                          {entryId && (
                            <button
                              type="button"
                              onClick={() => handleCompleteDashboardTask(taskItem)}
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all p-1 text-slate-500 hover:text-teal-400 hover:bg-teal-500/10 rounded-md border border-transparent hover:border-teal-500/20"
                              title="Complete and resolve insight"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <span className="leading-relaxed text-slate-200 break-words font-sans text-xs sm:text-sm">
                        {cleanTaskText}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                All prioritized steps have been completed or cleared into history.
              </p>
            )}

            {/* Document History (Completed Insights Log) */}
            {showDashboardHistory && completedDashboardTasks.length > 0 && (
              <div className="mt-5 pt-4 border-t border-white/5 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center justify-between mb-3 text-[11px] font-mono text-slate-500 uppercase">
                  <button
                    type="button"
                    onClick={() => setShowDashboardHistory(false)}
                    className="flex items-center gap-2 text-teal-400/90 hover:text-teal-300 transition-colors group cursor-pointer"
                    title="Click to hide completed insights history"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-teal-400" />
                    <span>Completed Insights History</span>
                    <span className="text-[10px] text-slate-500 group-hover:text-slate-400 normal-case ml-1 font-mono">(Click to hide)</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="italic normal-case text-slate-600 hidden sm:inline">Hover card to restore to active priorities</span>
                    <button
                      type="button"
                      onClick={() => setShowDashboardHistory(false)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/10 transition-colors"
                      title="Hide completed insights history"
                    >
                      <EyeOff className="w-3 h-3 text-slate-400" />
                      <span>Hide</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {completedDashboardTasks.map((taskItem, idx) => {
                    const raw = typeof taskItem === 'string' ? taskItem : taskItem.raw;
                    const { category, cleanTaskText } = parseCognitiveTask(raw);
                    const styleConfig =
                      COGNITIVE_LOAD_STYLES[category] || COGNITIVE_LOAD_STYLES['Standard'];
                    const entryDate = typeof taskItem === 'object' ? taskItem.entryDate : undefined;

                    return (
                      <div
                        key={idx}
                        className={`group relative flex flex-col justify-between gap-2 pl-3.5 pr-3 py-2.5 rounded-r-xl border border-white/[0.03] text-teal-500/70 line-through opacity-70 hover:opacity-100 transition-all duration-150 ${styleConfig.card}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] text-teal-500/50 tracking-widest font-mono uppercase">
                            {category}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {entryDate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCalendarDate(entryDate);
                                  setViewMode('calendar');
                                }}
                                className="text-[10px] font-mono text-slate-600 hover:text-indigo-300 transition-colors"
                                title={`Jump to calendar for ${entryDate}`}
                              >
                                {entryDate}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRestoreDashboardTask(taskItem)}
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 text-slate-500 hover:text-teal-300 hover:bg-teal-500/10 rounded-md border border-transparent hover:border-teal-500/20"
                              title="Restore task to active Untangled Next Steps"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
                            </button>
                          </div>
                        </div>
                        <span className="leading-relaxed break-words font-sans text-xs sm:text-sm text-teal-500/70 line-through">
                          {cleanTaskText}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Minimalist Slate Wipe Button */}
                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                  <button
                    type="button"
                    disabled={isClearingDashboardTasks}
                    onClick={handleClearCompletedDashboardTasks}
                    className="text-xs text-slate-500 hover:text-rose-400 transition-colors flex items-center gap-1.5 font-mono cursor-pointer disabled:opacity-50"
                    title="Wipe completed list while preserving count in yearly analytics"
                  >
                    {isClearingDashboardTasks ? (
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
            )}
          </div>
        )}

        {/* Journal Entries & Calendar Controls Section */}
        <div className="bg-[#0a0a0c]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="text-lg font-medium text-slate-200">Journal Archive</h3>
                <p className="text-xs text-slate-500">Access and manage your reflections by selecting dates in the calendar</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* View Switcher: Calendar vs List */}
              <div className="flex items-center bg-[#121214] border border-white/10 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewMode('calendar')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${viewMode === 'calendar'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Calendar View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${viewMode === 'list'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  <ListFilter className="w-3.5 h-3.5" />
                  All Entries
                </button>
              </div>

              {/* Hidden File Picker for Raw CSV */}
              <input
                ref={rawFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportRawCSV}
                className="hidden"
              />

              {/* Download Sample CSV Button */}
              <a
                href="/templates/journal_import_sample.csv"
                download="journal_import_sample.csv"
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 rounded-xl text-xs font-medium transition-all shadow-sm"
                title="Download Sample Import CSV Template"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
                <span>Sample CSV</span>
              </a>

              {/* Import Raw Entries (CSV) Button */}
              <button
                type="button"
                onClick={() => rawFileInputRef.current?.click()}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 rounded-xl text-xs font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group"
                title="Import bulk CSV (Date, Content, Manual_Mood) with automated Guhan AI synthesis"
              >
                {isImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-teal-400 group-hover:scale-110 transition-transform" />
                )}
                <span>Import Raw Entries (CSV)</span>
              </button>

              {/* Revert Last Import Button */}
              {effectiveRevertBatchId && (
                <button
                  type="button"
                  onClick={() => setShowRevertConfirmModal(true)}
                  disabled={isReverting || isImporting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-medium transition-all shadow-sm group disabled:opacity-50"
                  title="Undo and wipe recent historical CSV import batch"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-rose-400 group-hover:-rotate-45 transition-transform" />
                  <span>Revert Last Import</span>
                </button>
              )}


              {/* Export Vault (CSV) Button */}
              <button
                type="button"
                onClick={() => {
                  setExportError('');
                  setIsExportModalOpen(true);
                }}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 rounded-xl text-xs font-medium transition-all shadow-sm disabled:opacity-50 group"
                title="Export vault entries with date-range filter"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400 group-hover:translate-y-0.5 transition-transform" />
                <span>Export Vault (CSV)</span>
              </button>

              <button
                onClick={() => {
                  setNewDate(selectedCalendarDate || new Date().toISOString().split('T')[0]);
                  setNewPrompt('');
                  setIsAddModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-slate-200 font-semibold rounded-xl text-sm transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Entry
              </button>
            </div>
          </div>

          {viewMode === 'calendar' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Interactive Calendar */}
              <div className="lg:col-span-5 xl:col-span-5">
                <JournalCalendar
                  entries={entries}
                  selectedDate={selectedCalendarDate}
                  onSelectDate={(date) => setSelectedCalendarDate(date)}
                />
              </div>

              {/* Right Column: Selected Date Entries / Empty State */}
              <div className="lg:col-span-7 xl:col-span-7 flex flex-col">
                {selectedCalendarDate ? (
                  (() => {
                    const matchedEntries = entries.filter((e) => {
                      return getEntryLogicalDate(e) === selectedCalendarDate;
                    });

                    return (
                      <div className="bg-[#121214] border border-white/10 rounded-2xl p-6 flex flex-col min-h-[380px]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-white/5">
                          <div>
                            <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-400">
                              Selected Date
                            </span>
                            <h4 className="text-xl font-light text-slate-100 flex items-center gap-2 mt-0.5">
                              <Calendar className="w-5 h-5 text-indigo-400" />
                              {format(parseISO(selectedCalendarDate), 'EEEE, MMMM d, yyyy')}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
                              {matchedEntries.length} {matchedEntries.length === 1 ? 'reflection' : 'reflections'}
                            </span>
                            <button
                              onClick={() => {
                                setNewDate(selectedCalendarDate);
                                setNewPrompt('');
                                setIsAddModalOpen(true);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl transition-colors font-medium"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add
                            </button>
                          </div>
                        </div>

                        {matchedEntries.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 mb-3">
                              <BookOpen className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-medium text-slate-300">No reflections on this date.</p>
                            <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                              You haven&apos;t recorded a reflection for {format(parseISO(selectedCalendarDate), 'MMMM d, yyyy')}.
                            </p>
                            <button
                              onClick={() => {
                                setNewDate(selectedCalendarDate);
                                setNewPrompt('');
                                setIsAddModalOpen(true);
                              }}
                              className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                            >
                              + Record Entry for {format(parseISO(selectedCalendarDate), 'MMM d')}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1 custom-scrollbar">
                            {matchedEntries.map((entry) => (
                              <div
                                key={entry.id}
                                className="bg-[#0a0a0c] border border-white/10 rounded-xl p-5 hover:border-indigo-500/30 transition-all flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-1.5">
                                      {(typeof entry.Manual_Mood_Score === 'number' || typeof entry.manual_mood_score === 'number') && (
                                        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                                          You: {entry.Manual_Mood_Score ?? entry.manual_mood_score}/10 ({getManualMoodLabel(entry.Manual_Mood_Score ?? entry.manual_mood_score)})
                                        </span>
                                      )}
                                      {(typeof entry.Mood_Score === 'number' || typeof entry.mood_score === 'number') && (
                                        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                          AI: {entry.Mood_Score ?? entry.mood_score}/10
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] uppercase font-mono text-slate-500">
                                      ID: {entry.id.substring(0, 8)}
                                    </span>
                                  </div>

                                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap mb-4">
                                    {entry.original_prompt || entry.scrubbed_text}
                                  </p>

                                  {/* Media Attachment if present */}
                                  {(entry.media_url || entry.media_path) && (
                                    <div className="mb-4">
                                      <MediaAttachment
                                        entryId={entry.id}
                                        userId={user?.uid}
                                        mediaUrl={entry.media_url}
                                        mediaPath={entry.media_path}
                                        mediaType={entry.media_type}
                                        mediaName={entry.media_name}
                                        className="rounded-xl"
                                        variant="card"
                                        onMediaRestored={(url) => {
                                          entry.media_url = url;
                                          setEntries([...entries]);
                                        }}
                                      />
                                    </div>
                                  )}

                                  {/* Tags if present */}
                                  {entry.tags && Array.isArray(entry.tags) && entry.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-3">
                                      {entry.tags.map((tag: string, idx: number) => (
                                        <span
                                          key={idx}
                                          className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {/* Interactive Untangled Next Steps with Archival Deletion & History Log */}
                                  <UntangledTasks
                                    entry={entry}
                                    userId={user?.uid}
                                    variant="card"
                                    onEntryUpdated={handleEntryUpdated}
                                  />

                                  {entry.response_text && (
                                    <div className="mb-4 p-3 bg-indigo-950/20 rounded-lg border border-indigo-500/20 text-xs text-indigo-200 leading-relaxed">
                                      <p className="text-[10px] font-mono uppercase text-indigo-400 mb-1">Guhan&apos;s Reflection:</p>
                                      {entry.response_text}
                                    </div>
                                  )}
                                </div>

                                {(() => {
                                  const lockStatus = getEntryLockStatus(entry);
                                  return (
                                    <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-2">
                                      <div>
                                        {lockStatus.isLocked ? (
                                          <span
                                            className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 bg-white/[0.03] px-2 py-0.5 rounded border border-white/5"
                                            title="Permanently sealed: 7-day grace period from creation has elapsed."
                                          >
                                            <Lock className="w-3 h-3 text-slate-500" />
                                            <span>Permanently Sealed</span>
                                          </span>
                                        ) : (
                                          <span
                                            className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20"
                                            title={lockStatus.remainingText}
                                          >
                                            <Unlock className="w-2.5 h-2.5" />
                                            <span>{lockStatus.daysRemaining > 1 ? `${lockStatus.daysRemaining}d grace` : `${lockStatus.hoursRemaining}h grace`}</span>
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2">
                                        {lockStatus.canEditOrDelete ? (
                                          <>
                                            <button
                                              onClick={() => openEditModal(entry)}
                                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                            >
                                              <Pencil className="w-3.5 h-3.5" />
                                              Edit
                                            </button>
                                            <button
                                              onClick={() => handleDeleteEntry(entry)}
                                              disabled={isDeleting === entry.id}
                                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                                            >
                                              {isDeleting === entry.id ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                                              ) : (
                                                <Trash2 className="w-3.5 h-3.5" />
                                              )}
                                              Delete
                                            </button>
                                          </>
                                        ) : (
                                          <span className="text-[11px] font-mono text-slate-600 italic px-2 py-1" title="7-day edit window closed. This entry is sealed and immutable.">
                                            Sealed & Immutable
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="bg-[#121214] border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center text-center min-h-[380px]">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                      <Calendar className="w-7 h-7" />
                    </div>
                    <h4 className="text-lg font-medium text-slate-200 mb-1">Select a Date from the Calendar</h4>
                    <p className="text-sm text-slate-400 max-w-sm mb-6 leading-relaxed">
                      Click any date with a glowing dot in the calendar to immediately read, edit, or manage the reflections recorded on that day.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="text-xs text-slate-500">Quick jump:</span>
                      <button
                        onClick={() => setSelectedCalendarDate(new Date().toISOString().split('T')[0])}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 rounded-xl border border-white/10 transition-colors"
                      >
                        Today ({format(new Date(), 'MMM d')})
                      </button>
                      {entries[0] && (entries[0].entry_date || entries[0].createdAt?.toDate) && (
                        <button
                          onClick={() => {
                            const latestDate =
                              entries[0].entry_date || format(entries[0].createdAt.toDate(), 'yyyy-MM-dd');
                            setSelectedCalendarDate(latestDate);
                          }}
                          className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-xs font-mono text-indigo-300 rounded-xl border border-indigo-500/20 transition-colors"
                        >
                          Latest Entry (
                          {entries[0].entry_date
                            ? format(parseISO(entries[0].entry_date), 'MMM d')
                            : format(entries[0].createdAt.toDate(), 'MMM d')}
                          )
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* All Entries Grid View with Date Filter */
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 p-3 rounded-xl bg-[#121214] border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <span>Filter by date:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={listDateFilter}
                      onChange={(e) => setListDateFilter(e.target.value)}
                      className="bg-[#0a0a0c] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50 font-mono [color-scheme:dark]"
                    />
                    {listDateFilter && (
                      <button
                        type="button"
                        onClick={() => setListDateFilter('')}
                        className="px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Media Only Filter Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMediaOnlyFilter(!mediaOnlyFilter)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      mediaOnlyFilter
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm'
                        : 'bg-white/5 text-slate-400 hover:text-white border-white/10'
                    }`}
                    title="Toggle to show only entries with photos or videos"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      Media Only{' '}
                      {entries.filter((e) => e.media_url || e.media_path).length > 0 &&
                        `(${entries.filter((e) => e.media_url || e.media_path).length})`}
                    </span>
                  </button>
                </div>
              </div>

              {(() => {
                const listFilteredEntries = entries.filter((e) => {
                  if (mediaOnlyFilter && !e.media_url && !e.media_path) {
                    return false;
                  }
                  if (listDateFilter) {
                    return getEntryLogicalDate(e) === listDateFilter;
                  }
                  return true;
                });

                if (listFilteredEntries.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-500">
                      <p className="text-sm">No journal entries found{listDateFilter ? ` for ${listDateFilter}` : ''}.</p>
                      <button
                        onClick={() => {
                          setNewDate(listDateFilter || new Date().toISOString().split('T')[0]);
                          setIsAddModalOpen(true);
                        }}
                        className="mt-3 text-xs text-indigo-400 hover:underline font-medium"
                      >
                        Create an entry
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {listFilteredEntries.map((entry) => {
                      const formattedDate = entry.entry_date
                        ? format(parseISO(entry.entry_date), 'MMM d, yyyy')
                        : entry.createdAt?.toDate
                          ? format(entry.createdAt.toDate(), 'MMM d, yyyy')
                          : 'Unknown Date';

                      return (
                        <div
                          key={entry.id}
                          className="bg-[#121214] border border-white/10 rounded-xl p-5 flex flex-col justify-between group hover:border-white/20 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-mono text-indigo-400 font-medium flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5" />
                                {formattedDate}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {(typeof entry.Manual_Mood_Score === 'number' || typeof entry.manual_mood_score === 'number') && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                                    You: {entry.Manual_Mood_Score ?? entry.manual_mood_score}/10 ({getManualMoodLabel(entry.Manual_Mood_Score ?? entry.manual_mood_score)})
                                  </span>
                                )}
                                {(typeof entry.Mood_Score === 'number' || typeof entry.mood_score === 'number') && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                    AI: {entry.Mood_Score ?? entry.mood_score}/10
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-slate-300 line-clamp-3 leading-relaxed mb-4">
                              {entry.original_prompt || entry.scrubbed_text}
                            </p>

                            {/* Media Attachment Thumbnail if present */}
                            {(entry.media_url || entry.media_path) && (
                              <div className="mb-3">
                                <MediaAttachment
                                  entryId={entry.id}
                                  userId={user?.uid}
                                  mediaUrl={entry.media_url}
                                  mediaPath={entry.media_path}
                                  mediaType={entry.media_type}
                                  mediaName={entry.media_name}
                                  className="rounded-lg"
                                  variant="compact"
                                  onMediaRestored={(url) => {
                                    entry.media_url = url;
                                    setEntries([...entries]);
                                  }}
                                />
                              </div>
                            )}

                            {/* Interactive Untangled Next Steps with Archival Deletion & History Log */}
                            <UntangledTasks
                              entry={entry}
                              userId={user?.uid}
                              variant="card"
                              onEntryUpdated={handleEntryUpdated}
                            />
                          </div>

                          {(() => {
                            const lockStatus = getEntryLockStatus(entry);
                            return (
                              <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-auto">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] uppercase font-mono text-slate-600">
                                    ID: {entry.id.substring(0, 8)}
                                  </span>
                                  {lockStatus.isLocked ? (
                                    <span
                                      className="flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/5"
                                      title="Permanently sealed: 7-day grace period has elapsed."
                                    >
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>Sealed</span>
                                    </span>
                                  ) : (
                                    <span
                                      className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20"
                                      title={lockStatus.remainingText}
                                    >
                                      <Unlock className="w-2.5 h-2.5" />
                                      <span>{lockStatus.daysRemaining > 1 ? `${lockStatus.daysRemaining}d grace` : `${lockStatus.hoursRemaining}h`}</span>
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {lockStatus.canEditOrDelete ? (
                                    <>
                                      <button
                                        onClick={() => openEditModal(entry)}
                                        className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                        title="Edit Entry"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteEntry(entry)}
                                        disabled={isDeleting === entry.id}
                                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                                        title="Delete Entry"
                                      >
                                        {isDeleting === entry.id ? (
                                          <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                                        ) : (
                                          <Trash2 className="w-4 h-4" />
                                        )}
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-[10px] font-mono text-slate-600 px-1" title="Immutable: 7-day editing window has closed.">
                                      Locked
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Section 6: Settings & Danger Zone */}
        <div className="rounded-2xl border border-rose-900/30 bg-rose-500/5 p-6 backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono uppercase tracking-widest text-rose-400 font-bold">
                  Danger Zone
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono">
                  Permanent Security Action
                </span>
              </div>
              <h3 className="text-base font-medium text-slate-100">
                Delete Digital Vault
              </h3>
              <p className="text-xs text-slate-400 max-w-xl leading-relaxed mt-1">
                Permanently destroy your account profile, all journal reflections, emotion trajectory analytics, and any attached audio/visual media.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEradicateInput('');
              setIsEradicateModalOpen(true);
            }}
            disabled={isEradicating}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-200 border border-rose-500/30 hover:border-rose-500/50 rounded-xl text-xs font-semibold transition-all shadow-sm shrink-0 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Delete Digital Vault</span>
          </button>
        </div>

      </main>

      {/* Add Entry Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0a0a0c] border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <h3 className="text-lg font-medium text-slate-200">New Journal Entry</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEntry} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Entry Date *</label>
                <input
                  type="date"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={isSaving}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50 [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Journal Content *</label>
                <textarea
                  required
                  rows={5}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  disabled={isSaving}
                  placeholder="What's on your mind today?"
                  className="w-full bg-[#121214] border border-white/10 rounded-xl p-4 text-sm text-slate-200 outline-none focus:border-indigo-500/50 resize-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono text-slate-400">
                    How was your day? (Self-Assessment)
                  </label>
                  <span className="text-xs font-mono text-teal-300 font-bold">
                    {newManualMood !== null ? `${newManualMood}/10 · ${getManualMoodLabel(newManualMood)}` : 'Unrated'}
                  </span>
                </div>
                <div className="grid grid-cols-10 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isSaving}
                      onClick={() => setNewManualMood(num)}
                      className={`h-8 rounded-lg font-mono text-xs transition-all flex items-center justify-center ${
                        newManualMood === num
                          ? 'bg-teal-500/20 text-teal-200 border border-teal-400/50 shadow-[0_0_10px_rgba(45,212,191,0.3)] font-bold'
                          : 'bg-white/[0.03] text-slate-400 border border-white/5 hover:border-white/20 hover:text-slate-200'
                      }`}
                      title={`Rate: ${num}/10 (${getManualMoodLabel(num)})`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !newPrompt.trim() || !newDate}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white text-black hover:bg-slate-200 font-semibold rounded-xl text-sm disabled:opacity-50 transition-all"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Entry Modal */}
      {isEditModalOpen && editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0a0a0c] border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <h3 className="text-lg font-medium text-slate-200">Edit Journal Entry</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateEntry} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Entry Date *</label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  disabled={isSaving}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50 [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Journal Content *</label>
                <textarea
                  required
                  rows={5}
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  disabled={isSaving}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl p-4 text-sm text-slate-200 outline-none focus:border-indigo-500/50 resize-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono text-slate-400">
                    Your Self-Assessment Rating
                  </label>
                  <span className="text-xs font-mono text-teal-300 font-bold">
                    {editManualMood !== null ? `${editManualMood}/10 · ${getManualMoodLabel(editManualMood)}` : 'Unrated'}
                  </span>
                </div>
                <div className="grid grid-cols-10 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isSaving}
                      onClick={() => setEditManualMood(num)}
                      className={`h-8 rounded-lg font-mono text-xs transition-all flex items-center justify-center ${
                        editManualMood === num
                          ? 'bg-teal-500/20 text-teal-200 border border-teal-400/50 shadow-[0_0_10px_rgba(45,212,191,0.3)] font-bold'
                          : 'bg-white/[0.03] text-slate-400 border border-white/5 hover:border-white/20 hover:text-slate-200'
                      }`}
                      title={`Rate: ${num}/10 (${getManualMoodLabel(num)})`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2.5 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !editPrompt.trim() || !editDate}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white text-black hover:bg-slate-200 font-semibold rounded-xl text-sm disabled:opacity-50 transition-all"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Date-Ranged Export Vault Modal Dialog (#050505 Dark Sanctuary Theme) */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0a0c]/95 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-36 h-36 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/5 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-slate-100">Export Vault</h3>
                  <p className="text-xs text-slate-400">Select a date range to download your reflections</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Filter Presets */}
            <div className="mb-4 relative z-10">
              <label className="text-xs font-mono text-slate-400 block mb-2">Quick Presets</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExportFromDate(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
                    setExportToDate(format(new Date(), 'yyyy-MM-dd'));
                    setExportError('');
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-center"
                >
                  Last 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportFromDate(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
                    setExportToDate(format(new Date(), 'yyyy-MM-dd'));
                    setExportError('');
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-center"
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const dates = entries.map((e) => e.entry_date).filter(Boolean).sort();
                    const earliest = dates.length > 0 ? dates[0] : '2020-01-01';
                    setExportFromDate(earliest);
                    setExportToDate(format(new Date(), 'yyyy-MM-dd'));
                    setExportError('');
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-center"
                >
                  All Time
                </button>
              </div>
            </div>

            {/* Date inputs */}
            <div className="grid grid-cols-2 gap-3 mb-4 relative z-10">
              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1.5">From Date</label>
                <input
                  type="date"
                  value={exportFromDate}
                  onChange={(e) => {
                    setExportFromDate(e.target.value);
                    setExportError('');
                  }}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1.5">To Date</label>
                <input
                  type="date"
                  value={exportToDate}
                  onChange={(e) => {
                    setExportToDate(e.target.value);
                    setExportError('');
                  }}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Inline warning/toast if no entries exist */}
            {exportError && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2 relative z-10">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>{exportError}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/5 relative z-10">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                disabled={isExporting}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExportVaultCSV}
                disabled={isExporting || !exportFromDate || !exportToDate}
                className="flex items-center gap-1.5 px-4 py-2 bg-white text-black hover:bg-slate-200 font-semibold rounded-xl text-xs transition-all disabled:opacity-50 shadow-sm"
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Download CSV</span>
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Revert Last Import Confirmation Modal */}
      {showRevertConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#0a0a0c] border border-rose-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
                <h4 className="text-sm font-semibold">Revert Last Import</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowRevertConfirmModal(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Are you sure? This will remove all entries from the last CSV sync.
            </p>

            {effectiveRevertBatchId && (
              <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl mb-4 text-[11px] font-mono text-slate-400 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Batch ID:</span>
                  <span className="text-rose-300 font-semibold">{effectiveRevertBatchId.substring(0, 24)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Action:</span>
                  <span className="text-rose-400">Permanent vault purge</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowRevertConfirmModal(false)}
                disabled={isReverting}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={revertLastImport}
                disabled={isReverting}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
              >
                {isReverting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Reverting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Revert Import</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account & Digital Vault Eradication Confirmation Modal */}
      {isEradicateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#0a0a0c] border border-rose-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-36 h-36 bg-rose-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10 relative z-10">
              <div className="flex items-center gap-2.5 text-rose-400">
                <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Permanent Vault Eradication</h4>
                  <p className="text-[11px] font-mono text-rose-400">Irreversible Security Protocol</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isEradicating) {
                    setIsEradicateModalOpen(false);
                    setEradicateInput('');
                  }
                }}
                disabled={isEradicating}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl mb-4 relative z-10">
              <p className="text-xs text-rose-200 leading-relaxed font-medium">
                This will permanently destroy your account, all journal entries, and all attached media. This action cannot be undone.
              </p>
            </div>

            <div className="space-y-2 mb-5 relative z-10">
              <label className="block text-xs font-mono text-slate-400">
                Type <span className="text-white font-bold tracking-wider">ERADICATE</span> to confirm:
              </label>
              <input
                type="text"
                autoFocus
                disabled={isEradicating}
                value={eradicateInput}
                onChange={(e) => setEradicateInput(e.target.value)}
                placeholder="ERADICATE"
                className="w-full bg-[#121214] border border-white/10 focus:border-rose-500/60 rounded-xl px-4 py-2.5 text-sm font-mono text-white outline-none placeholder:text-slate-600 transition-colors"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 relative z-10">
              <button
                type="button"
                onClick={() => {
                  setIsEradicateModalOpen(false);
                  setEradicateInput('');
                }}
                disabled={isEradicating}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={eradicateInput.trim() !== 'ERADICATE' || isEradicating}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {isEradicating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Eradicating Vault...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Eradication</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Lightweight Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 max-w-sm sm:max-w-md w-full">
          <div
            className={`p-4 rounded-2xl border backdrop-blur-xl shadow-2xl flex items-start gap-3 bg-[#0d0d12]/95 ${
              toast.type === 'success'
                ? 'border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.15)]'
                : toast.type === 'error'
                ? 'border-red-500/30 shadow-[0_0_25px_rgba(239,68,68,0.15)]'
                : 'border-indigo-500/30 shadow-[0_0_25px_rgba(99,102,241,0.15)]'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : toast.type === 'error'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0 pr-1">
              <h5 className="text-xs font-semibold text-slate-200">{toast.title}</h5>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed break-words">{toast.message}</p>
            </div>

            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
