import { db, storage } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { saveToMediaVault, compressImageToDataUrl } from '@/lib/media-vault';

export const DAILY_QUOTA_BYTES = 1048576; // 1MB in bytes
export const ENTRY_DATE_QUOTA_BYTES = 1048576; // Strict 1MB limit per logical calendar date

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface QuotaCheckResult {
  allowed: boolean;
  currentUsage: number;
  remainingBytes: number;
  message?: string;
}

/**
 * Calculates current media byte usage strictly for a specific logical Entry_Date.
 * Sums:
 * - media_size / size fields on matching Firestore entry documents
 * - any items in attachments or mediaUrls arrays
 * - records in users/{userId}/usage/{entryDate}
 * Excludes excludeEntryId if updating an existing entry.
 */
export async function getDateMediaUsage(
  userId: string,
  entryDate: string,
  excludeEntryId?: string | null
): Promise<number> {
  if (!userId || !entryDate) return 0;

  try {
    let totalBytes = 0;
    const entriesRef = collection(db, 'users', userId, 'entries');

    // 1. Fetch entries matching logical Entry_Date (checking PascalCase & snake_case)
    const docMap = new Map<string, any>();

    try {
      const q1 = query(entriesRef, where('Entry_Date', '==', entryDate));
      const snap1 = await getDocs(q1);
      snap1.forEach((d) => docMap.set(d.id, d.data()));
    } catch (e1) {
      console.warn('Notice querying Entry_Date:', e1);
    }

    try {
      const q2 = query(entriesRef, where('entry_date', '==', entryDate));
      const snap2 = await getDocs(q2);
      snap2.forEach((d) => {
        if (!docMap.has(d.id)) {
          docMap.set(d.id, d.data());
        }
      });
    } catch (e2) {
      console.warn('Notice querying entry_date:', e2);
    }

    docMap.forEach((data, docId) => {
      // If editing an entry, exclude its current media size to allow replacement within quota
      if (excludeEntryId && docId === excludeEntryId) {
        return;
      }

      // Sum direct size fields
      if (typeof data.media_size === 'number' && data.media_size > 0) {
        totalBytes += data.media_size;
      } else if (typeof data.size === 'number' && data.size > 0) {
        totalBytes += data.size;
      }

      // Sum attachments array if present
      if (Array.isArray(data.attachments)) {
        data.attachments.forEach((att: any) => {
          if (typeof att?.size === 'number' && att.size > 0) {
            totalBytes += att.size;
          }
        });
      }

      // Sum mediaUrls array if present with size objects
      if (Array.isArray(data.mediaUrls)) {
        data.mediaUrls.forEach((m: any) => {
          if (typeof m?.size === 'number' && m.size > 0) {
            totalBytes += m.size;
          }
        });
      }
    });

    // 2. Return strictly based on actual media stored in Firestore
    // We removed the 'usage' tracking document because it caused permanent lockouts
    // if an upload failed or if an entry was deleted.

    return totalBytes;
  } catch (error) {
    console.warn(`Error calculating media usage for date ${entryDate}:`, error);
    return 0;
  }
}

/**
 * Pre-checks if attaching a file of size `fileSize` exceeds the 1MB allowance for `entryDate`.
 */
export async function checkDateQuota(
  userId: string,
  entryDate: string,
  fileSize: number,
  excludeEntryId?: string | null
): Promise<QuotaCheckResult> {
  const currentUsage = await getDateMediaUsage(userId, entryDate, excludeEntryId);
  const remainingBytes = Math.max(0, ENTRY_DATE_QUOTA_BYTES - currentUsage);

  if (currentUsage >= ENTRY_DATE_QUOTA_BYTES || currentUsage + fileSize > ENTRY_DATE_QUOTA_BYTES) {
    return {
      allowed: false,
      currentUsage,
      remainingBytes,
      message: 'Vault limit reached. Only 1MB of media is permitted per calendar date.',
    };
  }

  return {
    allowed: true,
    currentUsage,
    remainingBytes,
  };
}

/**
 * Backwards compatibility wrapper for daily bandwidth usage.
 */
export async function getDailyBandwidthUsage(userId: string, dateStr?: string): Promise<number> {
  const targetDate = dateStr || getTodayDateString();
  return getDateMediaUsage(userId, targetDate);
}

/**
 * Backwards compatibility wrapper for daily quota check.
 */
export async function checkDailyQuota(
  userId: string,
  fileSize: number,
  dateStr?: string
): Promise<QuotaCheckResult> {
  const targetDate = dateStr || getTodayDateString();
  return checkDateQuota(userId, targetDate, fileSize);
}

export interface UploadMediaResult {
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  bytesUploadedForDate: number;
  bytesUploadedToday: number;
  base64?: string;
  isFallback?: boolean;
}

/**
 * Reads a File object into a base64 encoded string safely in the browser.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read media attachment buffer.'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Validates file MIME and size, enforces a strict 1MB quota against the logical Entry_Date,
 * and then securely uploads the file to isolated Firebase Storage path: users/{userId}/media/{fileName}.
 * If the Storage bucket is unreachable/unprovisioned or times out, seamlessly falls back to the secured vault buffer.
 */
export async function uploadZeroTrustMedia(
  userId: string,
  file: File,
  entryDate: string,
  onProgress?: (percent: number) => void,
  excludeEntryId?: string | null
): Promise<UploadMediaResult> {
  if (!userId) {
    throw new Error('User authentication required for secure vault upload.');
  }

  const targetDate = entryDate || getTodayDateString();

  // 1. Client-side MIME type validation
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    throw new Error('Invalid file format. Only photo and video media are allowed in the sanctuary.');
  }

  // 2. Individual file size check against 1MB quota
  if (file.size > ENTRY_DATE_QUOTA_BYTES) {
    const error: any = new Error('Vault limit reached. Only 1MB of media is permitted per calendar date.');
    error.code = 'QUOTA_EXCEEDED';
    throw error;
  }

  // 3. Pre-Upload Validation (Gatekeeper): Check logical entry date usage
  const currentUsage = await getDateMediaUsage(userId, targetDate, excludeEntryId);
  if (currentUsage + file.size > ENTRY_DATE_QUOTA_BYTES) {
    const error: any = new Error('Vault limit reached. Only 1MB of media is permitted per calendar date.');
    error.code = 'QUOTA_EXCEEDED';
    throw error;
  }

  // 4. Usage transaction removed. Quota is now strictly enforced by the actual entries in Firestore.
  // This prevents permanent lockouts if an upload is aborted or an entry is deleted.
  const newTotalBytes = currentUsage + file.size;

  // 5. Read base64 buffer upfront for resilient multimodal AI synthesis & vault preservation
  let base64Data = '';
  let dataUrl = '';
  try {
    if (isImage) {
      dataUrl = await compressImageToDataUrl(file);
      base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    } else {
      base64Data = await readFileAsBase64(file);
      dataUrl = `data:${file.type};base64,${base64Data}`;
    }
  } catch (readErr: any) {
    console.warn('Failed to read file base64:', readErr);
  }

  // 6. Safe upload to Firebase Storage isolated path: users/{userId}/media/{fileName}
  const cleanBaseName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueFileName = `${Date.now()}_${cleanBaseName}`;
  const storagePath = `users/${userId}/media/${uniqueFileName}`;
  const storageRef = ref(storage, storagePath);

  // Store in local IndexedDB media vault upfront
  if (dataUrl) {
    try {
      await saveToMediaVault(storagePath, {
        dataUrl,
        mimeType: file.type,
        name: file.name,
        size: file.size,
      });
      await saveToMediaVault(uniqueFileName, {
        dataUrl,
        mimeType: file.type,
        name: file.name,
        size: file.size,
      });
    } catch (vaultErr) {
      console.warn('Pre-save to IndexedDB vault notice:', vaultErr);
    }
  }

  let downloadUrl = dataUrl;

  try {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        originalName: file.name,
        uploadedBy: userId,
        entryDate: targetDate,
        size: String(file.size),
      },
    });

    // 2.5-second watchdog timeout to avoid hanging if Storage bucket is unprovisioned/unreachable
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          uploadTask.cancel();
        } catch {}
        reject(new Error('Storage connection timed out. Preserving in secured local vault buffer.'));
      }, 2500);
    });

    const uploadPromise = new Promise<void>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (snapshot.totalBytes > 0 && onProgress) {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            onProgress(Math.round(progress));
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    await Promise.race([uploadPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    const cloudUrl = await getDownloadURL(uploadTask.snapshot.ref);
    if (cloudUrl) {
      downloadUrl = cloudUrl;
    }
    if (onProgress) onProgress(100);

    return {
      storagePath,
      downloadUrl,
      fileName: uniqueFileName,
      mimeType: file.type,
      size: file.size,
      bytesUploadedForDate: newTotalBytes,
      bytesUploadedToday: newTotalBytes,
      base64: base64Data,
    };
  } catch (storageErr: any) {
    console.warn(
      'Firebase Storage upload unavailable or unprovisioned (preserved securely in secured vault):',
      storageErr?.message || storageErr
    );
    if (onProgress) onProgress(100);

    return {
      storagePath,
      downloadUrl: downloadUrl || dataUrl || '',
      fileName: uniqueFileName,
      mimeType: file.type,
      size: file.size,
      bytesUploadedForDate: newTotalBytes,
      bytesUploadedToday: newTotalBytes,
      base64: base64Data,
      isFallback: true,
    };
  }
}
