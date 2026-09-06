'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, setDoc, doc, serverTimestamp, vector } from 'firebase/firestore';
import { uploadZeroTrustMedia } from '@/lib/quota';
import { getEntryLockStatus } from '@/lib/immutability';
import { BulkImportRow } from '@/lib/csv';

export const SUBMISSION_PROCESS_STEPS = [
  'Encrypting local payload...',
  'Analyzing emotional trajectory...',
  'Synthesizing actionable insights...',
  'Securing in digital vault...',
  'Finalizing secure lock...',
];

export interface JournalSubmissionPayload {
  userId: string;
  prompt: string;
  entryDate: string;
  manualMoodScore: number | null;
  selectedFile?: File | null;
  loadedEntryId?: string | null;
  existingEntry?: any;
}

export interface BackgroundProcessContextType {
  isProcessing: boolean;
  currentProcessIndex: number;
  currentStepText: string;
  currentStep: string;
  uploadProgress: number | null;
  error: string | null;
  lastSuccessMessage: string | null;
  activeEntryDate: string | null;
  submitJournalEntry: (payload: JournalSubmissionPayload) => void;
  dismissNotification: () => void;
  // Bulk CSV Ingestion Queue
  isImporting: boolean;
  importQueue: BulkImportRow[];
  importProgress: { current: number; total: number } | null;
  startBulkImport: (rows: BulkImportRow[], userId: string) => string;
}

const BackgroundProcessContext = createContext<BackgroundProcessContextType | null>(null);

export function BackgroundProcessProvider({ children }: { children: React.ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentProcessIndex, setCurrentProcessIndex] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessMessage, setLastSuccessMessage] = useState<string | null>(null);
  const [activeEntryDate, setActiveEntryDate] = useState<string | null>(null);

  // Bulk CSV Ingestion Queue States
  const [isImporting, setIsImporting] = useState(false);
  const [importQueue, setImportQueue] = useState<BulkImportRow[]>([]);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);

  const router = useRouter();
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Time-based cycling through submission phases while processing is active
  useEffect(() => {
    if (!isProcessing) {
      setCurrentProcessIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentProcessIndex((prev) => {
        if (prev < SUBMISSION_PROCESS_STEPS.length - 1) {
          return prev + 1;
        }
        return prev; // Hold on final phase until promise resolves
      });
    }, 1300);

    return () => clearInterval(interval);
  }, [isProcessing]);

  const dismissNotification = useCallback(() => {
    setError(null);
    setLastSuccessMessage(null);
  }, []);

  const submitJournalEntry = useCallback(
    (payload: JournalSubmissionPayload) => {
      const {
        userId,
        prompt,
        entryDate,
        manualMoodScore,
        selectedFile,
        loadedEntryId,
        existingEntry,
      } = payload;

      if (!userId || !prompt.trim()) return;

      // Lock status verification for editing existing entries
      if (loadedEntryId && existingEntry) {
        const lockStatus = getEntryLockStatus(existingEntry);
        if (lockStatus.isLocked) {
          setError('This reflection is permanently sealed (7-day grace period expired) and cannot be modified.');
          return;
        }
      }

      // Initialize background tracking state
      setIsProcessing(true);
      setCurrentProcessIndex(0);
      setError(null);
      setLastSuccessMessage(null);
      setActiveEntryDate(entryDate);
      setUploadProgress(null);

      // Execute background asynchronous pipeline without blocking the caller
      (async () => {
        try {
          let uploadedMedia: {
            storagePath?: string;
            downloadUrl?: string;
            fileName?: string;
            mimeType?: string;
            size?: number;
            base64?: string;
          } | null = null;

          // Step 1: Upload media to isolated zero-trust Firebase Storage if file attached
          if (selectedFile) {
            try {
              const uploadRes = await uploadZeroTrustMedia(
                userId,
                selectedFile,
                entryDate,
                (pct) => setUploadProgress(pct),
                loadedEntryId
              );

              uploadedMedia = {
                storagePath: uploadRes.storagePath,
                downloadUrl: uploadRes.downloadUrl,
                fileName: uploadRes.fileName,
                mimeType: uploadRes.mimeType,
                size: uploadRes.size,
                base64: uploadRes.base64,
              };
            } catch (uploadErr: any) {
              if (uploadErr.code === 'QUOTA_EXCEEDED' || uploadErr.message?.includes('Vault limit reached')) {
                throw new Error('Vault limit reached: Only 5MB of media is permitted per calendar date.');
              }
              throw uploadErr;
            }
          }

          // Step 2: Call Multimodal API Pipeline
          const response = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              userId,
              entryDate,
              mediaPath: uploadedMedia?.storagePath,
              mediaMimeType: uploadedMedia?.mimeType,
              mediaBase64: uploadedMedia?.base64,
            }),
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Failed to analyze journal entry.');
          }

          // Step 3: Automatically extract and save reminders to users/{userId}/reminders
          if (data.analysis?.reminders && Array.isArray(data.analysis.reminders)) {
            for (const rem of data.analysis.reminders) {
              if (rem && rem.title && rem.scheduled_time) {
                try {
                  const recObj =
                    typeof rem.recurrence === 'object' && rem.recurrence
                      ? rem.recurrence
                      : { type: typeof rem.recurrence === 'string' && rem.recurrence !== 'none' ? rem.recurrence : 'never' };
                  const isRec = recObj.type && recObj.type !== 'never';
                  const seriesId = isRec
                    ? `series_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
                    : null;

                  await addDoc(collection(db, 'users', userId, 'reminders'), {
                    Title: rem.title,
                    Scheduled_Date: rem.scheduled_time,
                    Scheduled_Time: rem.scheduled_time,
                    isCompleted: false,
                    isFlagged: false,
                    recurrence: recObj,
                    seriesId: seriesId,
                    Status: 'pending',
                    Timestamp: new Date().toISOString(),
                  });
                } catch (remErr) {
                  console.warn('Failed to auto-save reminder from background pipeline:', remErr);
                }
              }
            }
          }

          // Step 4: Prepare payload for Firestore users/{userId}/entries
          const savePayload: any = {
            Entry_Date: entryDate,
            entry_date: entryDate,
            Created_At: serverTimestamp(),
            createdAt: serverTimestamp(),
            original_prompt: prompt,
            scrubbed_text: data.scrubbed_text || prompt,
            mood_score: data.analysis.mood_score ?? 6,
            Mood_Score: data.analysis.mood_score ?? 6,
            manual_mood_score: manualMoodScore !== null ? Number(manualMoodScore) : null,
            Manual_Mood_Score: manualMoodScore !== null ? Number(manualMoodScore) : null,
            actionable_tasks: Array.isArray(data.analysis.actionable_tasks) && data.analysis.actionable_tasks.length > 0
              ? data.analysis.actionable_tasks
              : null,
            Actionable_Tasks: Array.isArray(data.analysis.actionable_tasks) && data.analysis.actionable_tasks.length > 0
              ? data.analysis.actionable_tasks
              : null,
            Completed_Tasks: [],
            completed_tasks: [],
            Archived_Task_Count: 0,
            archived_task_count: 0,
            discarded_tasks: [],
            Discarded_Tasks: [],
            response_text: data.analysis.response_text || '',
            tags: data.analysis.tags || ['#reflection'],
          };

          if (data.embedding && Array.isArray(data.embedding)) {
            try {
              savePayload.embedding = vector(data.embedding);
            } catch (vecErr) {
              console.warn('Could not format embedding with vector():', vecErr);
              savePayload.embedding = data.embedding;
            }
          }

          if (uploadedMedia) {
            savePayload.media_path = uploadedMedia.storagePath;
            savePayload.media_url = uploadedMedia.downloadUrl;
            savePayload.media_type = uploadedMedia.mimeType;
            savePayload.media_name = uploadedMedia.fileName;
            savePayload.media_size = uploadedMedia.size;
            savePayload.attachments = [
              {
                url: uploadedMedia.downloadUrl,
                path: uploadedMedia.storagePath,
                name: uploadedMedia.fileName,
                type: uploadedMedia.mimeType,
                size: uploadedMedia.size,
              },
            ];
            savePayload.mediaUrls = [uploadedMedia.downloadUrl];
          }

          // Step 5: Save or update in Firestore
          if (loadedEntryId) {
            const { Created_At, createdAt, ...updateFields } = savePayload;
            await updateDoc(doc(db, 'users', userId, 'entries', loadedEntryId), {
              ...updateFields,
              updatedAt: serverTimestamp(),
            });
          } else {
            await addDoc(collection(db, 'users', userId, 'entries'), savePayload);
          }

          // Step 6: Safe State Resolution & Revalidation
          const successMsg = 'Entry permanently secured in the vault.';
          setLastSuccessMessage(successMsg);
          setIsProcessing(false);
          setUploadProgress(null);

          // Clear success toast automatically after 5.5s
          if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
          successTimeoutRef.current = setTimeout(() => {
            setLastSuccessMessage(null);
          }, 5500);

          // Trigger Next.js router revalidation
          router.refresh();

          // Dispatch event so active Dashboard or Journal views re-fetch immediately without manual reload
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('guhan:entry-saved', {
                detail: {
                  entryDate,
                  loadedEntryId,
                  timestamp: Date.now(),
                },
              })
            );
          }
        } catch (err: any) {
          console.error('Background journal processing error:', err);
          setIsProcessing(false);
          setUploadProgress(null);
          setError(err.message || 'An unexpected error occurred while securing the entry.');
        }
      })();
    },
    [router]
  );

  const startBulkImport = useCallback(
    (rows: BulkImportRow[], userId: string) => {
      if (!userId || !rows || rows.length === 0) return '';

      const currentBatchId = 'batch_' + Date.now();
      if (typeof window !== 'undefined') {
        localStorage.setItem(`guhan_latest_import_batch_${userId}`, currentBatchId);
        window.dispatchEvent(
          new CustomEvent('guhan:batch-import-started', {
            detail: { batchId: currentBatchId, count: rows.length },
          })
        );
      }

      setIsImporting(true);
      setImportQueue(rows);
      setImportProgress({ current: 0, total: rows.length });
      setError(null);
      setLastSuccessMessage(null);

      // Execute sequential asynchronous rate-limit-aware ingestion pipeline
      (async () => {
        try {
          let currentIndex = 0;
          const totalRows = rows.length;

          for (const item of rows) {
            currentIndex++;
            setImportProgress({ current: currentIndex, total: totalRows });

            // 1. Send Content payload to Gemini API endpoint to generate Auto_Mood_Score and Actionable_Tasks
            let synthesized = {
              mood_score: 6,
              actionable_tasks: null as string[] | string | null,
              tags: ['#reflection'],
              scrubbed_text: item.content,
            };

            try {
              const res = await fetch('/api/synthesize-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: item.content,
                  date: item.date,
                  userId,
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data.success) {
                  synthesized = data;
                }
              }
            } catch (aiErr) {
              console.warn(`Gemini AI synthesis warning on row ${currentIndex} (${item.date}):`, aiErr);
            }

            const autoMoodScore =
              typeof synthesized.mood_score === 'number'
                ? Math.round(synthesized.mood_score)
                : 6;
            const actionableTasks = synthesized.actionable_tasks || null;

            // 2. Merge AI results with CSV row data (Date, Content, Manual_Mood) + Tag import_batch_id
            const docPayload: any = {
              id: item.date,
              userId,
              Entry_Date: item.date,
              entry_date: item.date,
              import_batch_id: currentBatchId,
              Import_Batch_ID: currentBatchId,
              original_prompt: item.content,
              scrubbed_text: synthesized.scrubbed_text || item.content,
              // Auto Mood Score generated from AI
              Mood_Score: autoMoodScore,
              mood_score: autoMoodScore,
              Auto_Mood_Score: autoMoodScore,
              auto_mood_score: autoMoodScore,
              // Manual Mood Score from CSV row
              Manual_Mood_Score: item.manualMood,
              manual_mood_score: item.manualMood,
              // Actionable Tasks from AI
              Actionable_Tasks: actionableTasks,
              actionable_tasks: actionableTasks,
              Completed_Tasks: [],
              completed_tasks: [],
              Archived_Task_Count: 0,
              archived_task_count: 0,
              discarded_tasks: [],
              Discarded_Tasks: [],
              tags: synthesized.tags || ['#reflection'],
              source: 'csv_ai_bulk_import',
              Timestamp: new Date().toISOString(),
              createdAt: serverTimestamp(),
              Created_At: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };

            // 3. Execute a Firestore setDoc to securely write the entry to users/{userId}/entries/{Date}
            await setDoc(doc(db, 'users', userId, 'entries', item.date), docPayload, { merge: true });

            // 4. Crucial: Implement mandatory 1500ms delay between each loop iteration to protect against Gemini API rate limits
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          // Persist latest import batch info to user settings in Firestore
          try {
            await setDoc(
              doc(db, 'users', userId, 'settings', 'import_metadata'),
              {
                latest_import_batch_id: currentBatchId,
                last_imported_at: serverTimestamp(),
                entry_count: totalRows,
              },
              { merge: true }
            );
          } catch (metaErr) {
            console.warn('Could not save import metadata to firestore:', metaErr);
          }

          // Graceful Completion & Revalidation
          setIsImporting(false);
          setImportQueue([]);
          setImportProgress(null);
          setLastSuccessMessage('Archive synthesis complete. Vault updated.');

          if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
          successTimeoutRef.current = setTimeout(() => {
            setLastSuccessMessage(null);
          }, 6000);

          router.refresh();

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('guhan:entry-saved', {
                detail: { isBulkImport: true, batchId: currentBatchId },
              })
            );
          }
        } catch (err: any) {
          console.error('Bulk CSV ingestion error:', err);
          setIsImporting(false);
          setImportQueue([]);
          setImportProgress(null);
          setError(err.message || 'Failed to complete archive synthesis.');
        }
      })();

      return currentBatchId;
    },
    [router]
  );

  const stepText = SUBMISSION_PROCESS_STEPS[currentProcessIndex] || 'Securing in digital vault...';
  const value: BackgroundProcessContextType = {
    isProcessing,
    currentProcessIndex,
    currentStepText: stepText,
    currentStep: stepText,
    uploadProgress,
    error,
    lastSuccessMessage,
    activeEntryDate,
    submitJournalEntry,
    dismissNotification,
    isImporting,
    importQueue,
    importProgress,
    startBulkImport,
  };

  return (
    <BackgroundProcessContext.Provider value={value}>
      {children}
    </BackgroundProcessContext.Provider>
  );
}

export function useBackgroundProcess() {
  const context = useContext(BackgroundProcessContext);
  if (!context) {
    throw new Error('useBackgroundProcess must be used within a BackgroundProcessProvider');
  }
  return context;
}
