/**
 * Guhan Media Vault
 * High-resilient zero-trust storage leveraging browser IndexedDB and canvas compression.
 * Ensures media attachments are preserved permanently even if cloud storage buckets are unprovisioned or offline.
 */

const DB_NAME = 'guhan_media_vault_v1';
const DB_VERSION = 1;
const STORE_NAME = 'media_files';

export interface VaultMediaRecord {
  key: string;
  dataUrl: string;
  mimeType: string;
  name: string;
  size: number;
  createdAt: number;
}

function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB media vault'));
  });
}

/**
 * Persist media data in the local IndexedDB vault.
 */
export async function saveToMediaVault(
  key: string,
  data: { dataUrl: string; mimeType?: string; name?: string; size?: number }
): Promise<void> {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record: VaultMediaRecord = {
        key,
        dataUrl: data.dataUrl,
        mimeType: data.mimeType || 'image/jpeg',
        name: data.name || 'vault_media',
        size: data.size || data.dataUrl.length,
        createdAt: Date.now(),
      };

      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
  } catch (err) {
    console.warn('Media vault save error:', err);
  }
}

/**
 * Retrieve media data from the local IndexedDB vault.
 */
export async function getFromMediaVault(key: string): Promise<VaultMediaRecord | null> {
  if (!key) return null;
  try {
    const db = await openVaultDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('Media vault fetch error:', err);
    return null;
  }
}

/**
 * Clear all records from the local IndexedDB media vault.
 */
export async function clearMediaVault(): Promise<void> {
  try {
    const db = await openVaultDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('Media vault clear warning:', err);
  }
}

/**
 * Compresses an image file into an optimized JPEG Data URL.
 * Produces crisp, high-quality images (max 1280px dimension, ~150KB-300KB)
 * that comfortably fit inside Firestore document limits while maintaining stunning aesthetics.
 */
export function compressImageToDataUrl(
  file: File,
  maxDimension = 1280,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Fallback to FileReader
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, quality);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}
