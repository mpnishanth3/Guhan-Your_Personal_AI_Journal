'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { Navigation } from '@/components/navigation';
import { JournalCalendar } from '@/components/JournalCalendar';
import { format, parseISO } from 'date-fns';
import {
  getDateMediaUsage,
  checkDateQuota,
  uploadZeroTrustMedia,
  ENTRY_DATE_QUOTA_BYTES,
} from '@/lib/quota';
import {
  getEntryLockStatus,
  getEntryLogicalDate,
  type EntryLockStatus,
} from '@/lib/immutability';
import { MediaAttachment } from '@/components/MediaAttachment';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { getManualMoodLabel } from '@/lib/utils';
import { UntangledTasks } from '@/components/UntangledTasks';
import { useBackgroundProcess } from '@/context/BackgroundProcessContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Send,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  CheckSquare,
  Eye,
  Pencil,
  RotateCcw,
  X,
  BookOpen,
  Paperclip,
  Mic,
  MicOff,
  Image as ImageIcon,
  Film,
  HardDrive,
  Lock,
  Unlock,
  HeartPulse,
} from 'lucide-react';

export default function JournalPage() {
  const { isProcessing, currentStep, submitJournalEntry } = useBackgroundProcess();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [manualMoodScore, setManualMoodScore] = useState<number | null>(7);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Calendar & Entry Access states
  const [entries, setEntries] = useState<any[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [loadedEntryId, setLoadedEntryId] = useState<string | null>(null);
  const [viewingDetailEntry, setViewingDetailEntry] = useState<any | null>(null);

  // Logical Entry_Date Quota & Media Attachment states
  const [dateMediaBytesUsed, setDateMediaBytesUsed] = useState<number>(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gentle Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);

  const showToastNotification = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // Client-Side Speech-to-Text (Voice Dictation)
  const { isListening, isSupported: isSpeechSupported, toggleListening } = useSpeechRecognition({
    onTranscriptAppend: (text) => {
      setPrompt((prev) => {
        if (!prev) return text;
        const separator = /\s$/.test(prev) ? '' : ' ';
        return `${prev}${separator}${text}`;
      });
    },
    onErrorToast: (msg) => {
      showToastNotification(msg, 'error');
    },
  });

  const router = useRouter();

  const refreshDateMediaUsage = useCallback(
    async (targetDate: string, targetEntryId?: string | null) => {
      if (!user?.uid || !targetDate) return;
      const bytes = await getDateMediaUsage(user.uid, targetDate, targetEntryId);
      setDateMediaBytesUsed(bytes);
    },
    [user?.uid]
  );

  const fetchUserEntries = useCallback(async (uid: string) => {
    try {
      const q = query(collection(db, 'users', uid, 'entries'), orderBy('createdAt', 'desc'), limit(100));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setEntries(list);
    } catch (err) {
      console.error('Error fetching user entries for calendar:', err);
    }
  }, []);

  // Listen to background entry completion to refresh entries and media quota
  useEffect(() => {
    const handleEntrySaved = (event: Event) => {
      const customEvent = event as CustomEvent<{ entryDate?: string }>;
      if (user?.uid) {
        fetchUserEntries(user.uid);
        if (customEvent.detail?.entryDate) {
          refreshDateMediaUsage(customEvent.detail.entryDate, loadedEntryId);
        }
      }
    };

    window.addEventListener('guhan:entry-saved', handleEntrySaved);
    return () => {
      window.removeEventListener('guhan:entry-saved', handleEntrySaved);
    };
  }, [user?.uid, loadedEntryId, refreshDateMediaUsage, fetchUserEntries]);

  useEffect(() => {
    if (user?.uid && entryDate) {
      refreshDateMediaUsage(entryDate, loadedEntryId);
    }
  }, [user?.uid, entryDate, loadedEntryId, refreshDateMediaUsage]);

  const fetchUsage = async (uid: string) => {
    try {
      if (entryDate) {
        const bytes = await getDateMediaUsage(uid, entryDate, loadedEntryId);
        setDateMediaBytesUsed(bytes);
      }
    } catch (err) {
      console.warn('Error checking date media quota:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push('/');
      } else {
        setUser(currentUser);
        await Promise.all([
          fetchUserEntries(currentUser.uid),
          fetchUsage(currentUser.uid),
        ]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  // Clean up object preview URL on unmount or file change
  useEffect(() => {
    return () => {
      if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  // Find if an entry already exists for the selected date using decoupled logical date
  const matchingEntry = entries.find((e) => getEntryLogicalDate(e) === entryDate);
  const matchingLockStatus: EntryLockStatus | null = matchingEntry ? getEntryLockStatus(matchingEntry) : null;

  // Track lock status if an entry is actively loaded in the editor
  const loadedEntry = loadedEntryId ? entries.find((e) => e.id === loadedEntryId) : null;
  const currentEditorLockStatus: EntryLockStatus | null = loadedEntry
    ? getEntryLockStatus(loadedEntry)
    : matchingEntry && loadedEntryId === matchingEntry.id
      ? matchingLockStatus
      : null;

  const handleLoadEntry = (entry: any) => {
    const lockStatus = getEntryLockStatus(entry);
    if (lockStatus.isLocked) {
      showToastNotification('This reflection is permanently sealed (7-day grace period expired).', 'error');
      return;
    }
    setPrompt(entry.original_prompt || entry.scrubbed_text || '');
    setLoadedEntryId(entry.id);
    const loadedManualMood = typeof entry.Manual_Mood_Score === 'number'
      ? entry.Manual_Mood_Score
      : typeof entry.manual_mood_score === 'number'
        ? entry.manual_mood_score
        : null;
    setManualMoodScore(loadedManualMood !== null ? loadedManualMood : 7);
    setSelectedFile(null);
    setFilePreviewUrl(entry.media_url || null);
    setError('');
    setSuccess(`Loaded entry for ${getEntryLogicalDate(entry)} into the editor.`);
  };

  const handleResetToNew = () => {
    setLoadedEntryId(null);
    setPrompt('');
    setManualMoodScore(7);
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setSuccess('');
    setError('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Reset input value so user can reselect if needed
    e.target.value = '';

    // Validate MIME type strictly
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      showToastNotification('Only photo and video attachments are permitted in the vault.', 'error');
      return;
    }

    // Pre-Upload Validation (Client-Side Gatekeeper) based strictly on logical Entry_Date
    const quotaResult = await checkDateQuota(user.uid, entryDate, file.size, loadedEntryId);
    if (!quotaResult.allowed) {
      showToastNotification('Vault limit reached. Only 5MB of media is permitted per calendar date.', 'error');
      return;
    }

    // Set file and preview
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);
  };

  const handleRemoveSelectedFile = () => {
    if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setUploadProgress(null);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || !user) return;
    if (!entryDate) {
      setError('Please select a valid date for your entry.');
      return;
    }

    if (loadedEntryId && currentEditorLockStatus?.isLocked) {
      setError('This reflection is permanently sealed (7-day grace period expired) and cannot be modified.');
      return;
    }

    setError('');
    setSuccess('');

    // Package the payload for the global background process
    const payload = {
      prompt: prompt.trim(),
      userId: user.uid,
      entryDate,
      manualMoodScore: manualMoodScore !== null ? Number(manualMoodScore) : null,
      loadedEntryId: loadedEntryId || null,
      selectedFile: selectedFile || null,
    };

    // Dispatch without awaiting to free the user immediately
    submitJournalEntry(payload);

    // Instantly reset local composer state
    setPrompt('');
    setManualMoodScore(7);
    setSelectedFile(null);
    if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    setFilePreviewUrl(null);
    setLoadedEntryId(null);
    setUploadProgress(null);

    showToastNotification('Entry sent to background vault. You can safely navigate.', 'info');
  };

  const dateQuotaExhausted = dateMediaBytesUsed >= ENTRY_DATE_QUOTA_BYTES;

  if (loading) {
    return (
      <div suppressHydrationWarning className="flex items-center justify-center min-h-screen bg-transparent text-slate-400 font-sans">
        <p className="text-sm font-mono tracking-widest uppercase animate-pulse">Authenticating Sanctuary Vault...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div suppressHydrationWarning className="min-h-screen bg-transparent text-[#e2e8f0] font-sans flex flex-col">
      <Navigation />

      {/* Gentle Floating Sanctuary Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl backdrop-blur-xl border shadow-2xl flex items-center gap-2.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${toast.type === 'error'
              ? 'bg-red-950/80 border-red-500/30 text-red-200'
              : toast.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-200'
                : 'bg-[#121214]/90 border-white/10 text-slate-200'
            }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <span className="text-xs font-medium">{toast.message}</span>
        </div>
      )}

      <main className="flex-1 max-w-4xl w-full mx-auto p-8 flex flex-col">
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" /> Zero-Trust Privacy Shield
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-light tracking-tight mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-300 to-slate-100">
            Guhan — Your Personal AI Sanctuary
          </h1>
          <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
            Your innermost thoughts and secure media are safely locked away. Bring whatever weighs on your mind, and leave it secured within the secret cave.
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-900/20 border border-red-500/20 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-300">Transaction Incomplete</h3>
              <p className="text-xs text-red-400/80 mt-1">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-900/20 border border-emerald-500/20 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-sm font-medium text-emerald-300">{success}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-6">
          {/* Mandatory Date Selector Bar & Calendar Trigger */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-[#0a0a0c]/80 backdrop-blur-md border border-white/10">
            <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>
                Entry Date <span className="text-red-400 font-bold">*</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                required
                value={entryDate}
                onChange={(e) => {
                  setEntryDate(e.target.value);
                  setLoadedEntryId(null);
                }}
                className="bg-[#121214] border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50 transition-all font-mono [color-scheme:dark]"
              />

              <button
                type="button"
                onClick={() => setShowCalendarModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl font-medium transition-colors"
                title="Browse Entries by Calendar"
              >
                <Calendar className="w-3.5 h-3.5" />
                Select in Calendar
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntryDate(new Date().toISOString().split('T')[0]);
                  setLoadedEntryId(null);
                }}
                disabled={entryDate === new Date().toISOString().split('T')[0]}
                className="px-3 py-2 text-xs bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border border-white/10 rounded-xl font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Today
              </button>
            </div>
          </div>

          {/* Existing Entry for Date Notification Banner */}
          {matchingEntry && (
            <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-indigo-200">
                      Reflection found for {format(parseISO(entryDate), 'MMM d, yyyy')}
                    </span>
                    {matchingLockStatus?.isLocked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        <Lock className="w-3 h-3 text-slate-400" />
                        Permanently Sealed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        <Unlock className="w-3 h-3 text-emerald-400" />
                        Grace Period: {matchingLockStatus?.daysRemaining}d {matchingLockStatus?.hoursRemaining}h left
                      </span>
                    )}
                    {(typeof matchingEntry.Manual_Mood_Score === 'number' || typeof matchingEntry.manual_mood_score === 'number') && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/20">
                        You: {matchingEntry.Manual_Mood_Score ?? matchingEntry.manual_mood_score}/10 ({getManualMoodLabel(matchingEntry.Manual_Mood_Score ?? matchingEntry.manual_mood_score)})
                      </span>
                    )}
                    {(typeof matchingEntry.Mood_Score === 'number' || typeof matchingEntry.mood_score === 'number') && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">
                        AI: {matchingEntry.Mood_Score ?? matchingEntry.mood_score}/10
                      </span>
                    )}
                    {(matchingEntry.media_url || matchingEntry.media_path) && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">
                        Media Attached
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                    {matchingEntry.original_prompt || matchingEntry.scrubbed_text}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setViewingDetailEntry(matchingEntry)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View
                </button>

                {matchingLockStatus?.isLocked ? (
                  <span className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-900 text-slate-500 rounded-lg border border-slate-800 font-mono">
                    <Lock className="w-3 h-3" />
                    Immutable
                  </span>
                ) : loadedEntryId === matchingEntry.id ? (
                  <button
                    type="button"
                    onClick={handleResetToNew}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg border border-white/10 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLoadEntry(matchingEntry)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors shadow-sm"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Load & Edit
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active Editing or Immutability Lock Indicator */}
          {currentEditorLockStatus?.isLocked ? (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-900/90 border border-white/10 text-slate-300 text-xs">
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  <strong>Permanently Sealed:</strong> This memory has passed its 7-day grace period from system creation (
                  {currentEditorLockStatus.createdDate
                    ? format(currentEditorLockStatus.createdDate, 'MMM d, yyyy')
                    : 'recorded'}
                  ). It is strictly immutable and cannot be modified.
                </span>
              </span>
              <button
                type="button"
                onClick={handleResetToNew}
                className="text-indigo-400 hover:text-indigo-300 underline font-mono text-[11px] shrink-0 ml-4"
              >
                Compose New
              </button>
            </div>
          ) : loadedEntryId ? (
            <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
              <span className="flex items-center gap-2">
                <Unlock className="w-3.5 h-3.5 text-amber-400" />
                Editing entry for {entryDate}. Grace period active ({currentEditorLockStatus?.daysRemaining}d {currentEditorLockStatus?.hoursRemaining}h remaining to modify).
              </span>
              <button
                type="button"
                onClick={handleResetToNew}
                className="text-amber-300 hover:text-amber-100 underline font-mono text-[11px]"
              >
                Cancel Edit
              </button>
            </div>
          ) : null}

          {/* Main Textarea with Speech Dictation & Attachment Actions */}
          <div className="flex-1 relative group rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0c]/80 backdrop-blur-md transition-all focus-within:border-indigo-500/50 focus-within:shadow-[0_0_30px_rgba(99,102,241,0.1)] flex flex-col">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={Boolean(currentEditorLockStatus?.isLocked)}
              placeholder={
                currentEditorLockStatus?.isLocked
                  ? "This reflection is permanently sealed and immutable."
                  : "Pour your heart out, celebrate a win, or reflect on your day... (Speak via the mic or attach photos/videos)"
              }
              className="w-full flex-1 min-h-[260px] bg-transparent p-6 outline-none resize-none placeholder:text-slate-600 text-slate-200 leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed"
            />

            {/* Composer Toolbar (Minimalist Attachment & Mic Controls) */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-white/5 bg-[#050505]/40">
              <div className="flex items-center gap-3">
                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,video/*"
                  className="hidden"
                />

                {/* Minimalist Attachment Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (currentEditorLockStatus?.isLocked) return;
                    if (dateQuotaExhausted) {
                      showToastNotification('Vault limit reached. Only 5MB of media is permitted per calendar date.', 'error');
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  disabled={dateQuotaExhausted || Boolean(currentEditorLockStatus?.isLocked)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${currentEditorLockStatus?.isLocked || dateQuotaExhausted
                      ? 'opacity-40 cursor-not-allowed text-slate-600 bg-white/[0.02]'
                      : 'text-slate-400 hover:text-indigo-300 hover:bg-white/5 border border-white/5 hover:border-indigo-500/30'
                    }`}
                  title={
                    currentEditorLockStatus?.isLocked
                      ? 'Entry is permanently sealed (immutable)'
                      : dateQuotaExhausted
                        ? 'Vault limit reached. Only 5MB of media is permitted per calendar date.'
                        : 'Attach photo or video (<5MB)'
                  }
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>Attach Media</span>
                </button>

                {/* Minimalist Speech-to-Text Microphone Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (currentEditorLockStatus?.isLocked) return;
                    if (!isSpeechSupported) {
                      showToastNotification('Voice dictation is not supported in this browser.', 'error');
                      return;
                    }
                    toggleListening();
                  }}
                  disabled={Boolean(currentEditorLockStatus?.isLocked)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${currentEditorLockStatus?.isLocked || !isSpeechSupported
                      ? 'opacity-40 cursor-not-allowed text-slate-600 bg-white/[0.02]'
                      : isListening
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_20px_rgba(244,63,94,0.35)] animate-pulse'
                        : 'text-slate-400 hover:text-indigo-300 hover:bg-white/5 border border-white/5 hover:border-indigo-500/30'
                    }`}
                  title={
                    currentEditorLockStatus?.isLocked
                      ? 'Entry is permanently sealed (immutable)'
                      : !isSpeechSupported
                        ? 'Voice dictation is not supported in this browser'
                        : isListening
                          ? 'Stop listening (Voice Dictation active)'
                          : 'Start voice dictation'
                  }
                >
                  {isListening ? (
                    <>
                      <Mic className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                      <span className="font-mono text-[11px] text-rose-300">Listening...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Dictate</span>
                    </>
                  )}
                </button>
              </div>

              {/* Character counter & listening indicator */}
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                {isListening && (
                  <span className="flex items-center gap-1.5 text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                    Transcribing to vault
                  </span>
                )}
                <span>{prompt.length} chars</span>
              </div>
            </div>
          </div>

          {/* Media Preview Card & Minimalist Date Quota Visibility */}
          {(selectedFile || filePreviewUrl) && (
            <div className="p-4 rounded-2xl bg-[#0a0a0c]/85 border border-indigo-500/20 backdrop-blur-md flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                    {selectedFile?.type.startsWith('video/') || filePreviewUrl?.includes('.mp4') ? (
                      <Film className="w-6 h-6 text-indigo-400" />
                    ) : filePreviewUrl ? (
                      <img src={filePreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-indigo-400" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        {selectedFile ? selectedFile.name : 'Attached Vault Media'}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">
                        {selectedFile
                          ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                          : matchingEntry?.media_size
                            ? `${(matchingEntry.media_size / (1024 * 1024)).toFixed(2)} MB`
                            : 'Encrypted Media'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {uploadProgress !== null
                        ? `Encrypting and transferring: ${uploadProgress}%`
                        : `Bound to logical date: ${entryDate}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  {uploadProgress !== null && (
                    <div className="w-24 bg-white/10 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleRemoveSelectedFile}
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                    title="Remove attachment"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Minimalist Date Quota Progress Bar & Readout (Strict 5MB per calendar date) */}
              {(() => {
                const totalForDate = dateMediaBytesUsed + (selectedFile ? selectedFile.size : 0);
                const usedMB = (totalForDate / (1024 * 1024)).toFixed(1);
                const pct = Math.min(100, Math.max(2, (totalForDate / 5242880) * 100));

                return (
                  <div className="pt-2 border-t border-white/5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <HardDrive className="w-3 h-3 text-indigo-400" />
                        <span>Date Vault Quota:</span>
                      </span>
                      <span className="text-slate-300">
                        <strong className="text-indigo-300">{usedMB}MB</strong> / 5.0MB secured for this date
                      </span>
                    </div>

                    {/* Sleek ultra-thin progress bar (h-1 bg-slate-800 with bg-indigo-500 fill) */}
                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Human-in-the-Loop: Minimalist 1–10 Manual Mood Selector */}
          <div className="p-4 rounded-2xl bg-[#0a0a0c]/80 backdrop-blur-md border border-white/10 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                  <HeartPulse className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-200">
                    How are you feeling today?
                  </span>
                  <span className="text-[11px] text-slate-400 block sm:inline sm:ml-2">
                    (Self-assessment rating)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {manualMoodScore !== null ? (
                  <span className="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30">
                    {manualMoodScore}/10 &middot; {getManualMoodLabel(manualMoodScore)}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-slate-500">Unrated</span>
                )}
                {manualMoodScore !== null && !currentEditorLockStatus?.isLocked && (
                  <button
                    type="button"
                    onClick={() => setManualMoodScore(null)}
                    className="text-[10px] font-mono text-slate-500 hover:text-slate-300 underline transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Discrete 1-10 selector buttons */}
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const isSelected = manualMoodScore === num;
                return (
                  <button
                    key={num}
                    type="button"
                    disabled={Boolean(currentEditorLockStatus?.isLocked)}
                    onClick={() => setManualMoodScore(num)}
                    className={`h-9 rounded-xl font-mono text-xs transition-all flex flex-col items-center justify-center ${isSelected
                        ? 'bg-teal-500/20 text-teal-200 border border-teal-400/50 shadow-[0_0_15px_rgba(45,212,191,0.35)] font-bold scale-[1.03]'
                        : 'bg-white/[0.03] text-slate-400 border border-white/5 hover:border-white/20 hover:text-slate-200 hover:bg-white/[0.07]'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={`Rate your day: ${num}/10 (${getManualMoodLabel(num)})`}
                  >
                    <span>{num}</span>
                  </button>
                );
              })}
            </div>

            {/* Slider track for fluid touch adjustment */}
            <div className="flex items-center gap-3 pt-1">
              <span className="text-[10px] font-mono text-slate-500">1 (Overwhelmed)</span>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={manualMoodScore || 7}
                disabled={Boolean(currentEditorLockStatus?.isLocked)}
                onChange={(e) => setManualMoodScore(parseInt(e.target.value, 10))}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
              />
              <span className="text-[10px] font-mono text-slate-500">10 (Thriving)</span>
            </div>
          </div>

          {/* Submission Bar & Dynamic Process Sequence */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <div className="flex items-center min-h-[38px]">
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-slate-300 font-mono text-xs tracking-wide"
                  >
                    {/* Softly pulsing sanctuary dot indicator beside process name */}
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400"></span>
                    </span>
                    <span>{currentStep}</span>
                  </motion.div>
                ) : (
                  <span className="text-xs font-mono text-slate-500">
                    Encrypted end-to-end with zero-trust storage boundaries.
                  </span>
                )}
              </AnimatePresence>
            </div>

            {currentEditorLockStatus?.isLocked ? (
              <div className="flex items-center gap-2 px-6 py-3.5 bg-slate-900 text-slate-400 border border-slate-700/80 rounded-xl text-xs font-mono">
                <Lock className="w-4 h-4 text-slate-500" />
                <span>Memory Permanently Sealed (Immutable)</span>
              </div>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="relative group flex items-center gap-2 px-8 py-4 rounded-xl font-semibold transition-all bg-white text-black hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
                <span>{loadedEntryId ? '🔒 Reseal Updated Entry' : '🔒 Seal Entry'}</span>
                {prompt.trim() && (
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-300 -z-10"></div>
                )}
              </button>
            )}
          </div>
        </form>
      </main>

      {/* Calendar Selector Modal */}
      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#0a0a0c] border border-white/10 rounded-2xl p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-medium text-slate-100">Select Date in Calendar</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCalendarModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Days with glowing indicators contain recorded reflections. Click any date to jump to it.
            </p>

            <JournalCalendar
              entries={entries}
              selectedDate={entryDate}
              onSelectDate={(dateStr) => {
                if (dateStr) {
                  setEntryDate(dateStr);
                  setLoadedEntryId(null);
                  setShowCalendarModal(false);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* View Entry Details Modal */}
      {viewingDetailEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#0a0a0c] border border-white/10 rounded-2xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
              <div>
                <span className="text-[11px] font-mono uppercase text-indigo-400">Journal Record</span>
                <h3 className="text-base font-medium text-slate-100 mt-0.5">
                  {viewingDetailEntry.Entry_Date || viewingDetailEntry.entry_date
                    ? format(parseISO(viewingDetailEntry.Entry_Date || viewingDetailEntry.entry_date), 'EEEE, MMMM d, yyyy')
                    : 'Recorded Entry'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingDetailEntry(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar text-sm">
              {/* Vault Immutability & Grace Period Telemetry */}
              {(() => {
                const detailLock = getEntryLockStatus(viewingDetailEntry);
                return (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
                    <span className="font-mono text-slate-400">Vault Immutability:</span>
                    {detailLock.isLocked ? (
                      <span className="inline-flex items-center gap-1.5 font-mono px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        Permanently Sealed (7-Day Lock)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                        Grace Period: {detailLock.daysRemaining}d {detailLock.hoursRemaining}h left
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Dual Mood Badges in Detail Modal */}
              {(() => {
                const aiMood = typeof viewingDetailEntry.Mood_Score === 'number'
                  ? viewingDetailEntry.Mood_Score
                  : typeof viewingDetailEntry.mood_score === 'number'
                    ? viewingDetailEntry.mood_score
                    : null;
                const manualMood = typeof viewingDetailEntry.Manual_Mood_Score === 'number'
                  ? viewingDetailEntry.Manual_Mood_Score
                  : typeof viewingDetailEntry.manual_mood_score === 'number'
                    ? viewingDetailEntry.manual_mood_score
                    : null;

                if (aiMood === null && manualMood === null) return null;

                return (
                  <div className="flex flex-wrap items-center gap-3">
                    {manualMood !== null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-teal-400">Your Rating:</span>
                        <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30">
                          {manualMood}/10 &middot; {getManualMoodLabel(manualMood)}
                        </span>
                      </div>
                    )}
                    {aiMood !== null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-indigo-400">Guhan AI:</span>
                        <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          {aiMood}/10
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Secure Media Attachment View */}
              {(viewingDetailEntry.media_url || viewingDetailEntry.media_path) && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-2">
                    {viewingDetailEntry.media_type?.startsWith('video/') ? (
                      <Film className="w-3.5 h-3.5 text-indigo-400" />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>Encrypted Attachment</span>
                  </div>
                  <MediaAttachment
                    entryId={viewingDetailEntry.id}
                    userId={user?.uid}
                    mediaUrl={viewingDetailEntry.media_url}
                    mediaPath={viewingDetailEntry.media_path}
                    mediaType={viewingDetailEntry.media_type}
                    mediaName={viewingDetailEntry.media_name}
                    className="rounded-lg"
                    variant="detail"
                    onMediaRestored={(url) => {
                      viewingDetailEntry.media_url = url;
                    }}
                  />
                </div>
              )}

              <div>
                <h4 className="text-xs font-mono text-slate-400 uppercase mb-1">Your Reflection:</h4>
                <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {viewingDetailEntry.original_prompt || viewingDetailEntry.scrubbed_text}
                </div>
              </div>

              {/* Interactive Untangled Next Steps with Archival Deletion & History Log */}
              <UntangledTasks
                entry={viewingDetailEntry}
                userId={user?.uid}
                variant="modal"
                onEntryUpdated={(updated) => {
                  setViewingDetailEntry(updated);
                  setEntries((prev) =>
                    prev.map((e) => (e.id === updated.id ? updated : e))
                  );
                }}
              />

              {viewingDetailEntry.response_text && (
                <div>
                  <h4 className="text-xs font-mono text-indigo-400 uppercase mb-1">Guhan&apos;s Insight:</h4>
                  <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-xs text-indigo-200 leading-relaxed">
                    {viewingDetailEntry.response_text}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-white/10 flex justify-end gap-2">
              {(() => {
                const isLocked = getEntryLockStatus(viewingDetailEntry).isLocked;
                if (isLocked) {
                  return (
                    <span className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-white/10 rounded-xl text-xs font-mono text-slate-500">
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      Sealed (Immutable)
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => {
                      handleLoadEntry(viewingDetailEntry);
                      setViewingDetailEntry(null);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Load into Editor
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
