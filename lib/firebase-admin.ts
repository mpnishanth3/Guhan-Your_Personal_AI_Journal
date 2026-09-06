import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0558990988';
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0558990988.firebasestorage.app';

export function getAdminApp(): App {
  const currentApps = getApps();
  if (currentApps.length === 0) {
    return initializeApp({
      projectId,
      storageBucket,
    });
  }
  return currentApps[0];
}

export function getAdminStorage() {
  const app = getAdminApp();
  return getStorage(app);
}

export function getAdminFirestore() {
  const app = getAdminApp();
  return getFirestore(app);
}

/**
 * Securely fetch media file buffer from isolated Firebase Storage path (users/{userId}/media/{fileName})
 * Media files are never exposed via public URLs.
 */
export async function getStorageMediaBuffer(filePath: string): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  try {
    const adminStorage = getAdminStorage();
    const bucket = adminStorage.bucket();
    const file = bucket.file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      console.warn(`File does not exist in storage bucket: ${filePath}`);
      return null;
    }

    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();

    return {
      buffer,
      mimeType: metadata.contentType || undefined,
    };
  } catch (error) {
    console.error('Firebase Admin storage buffer retrieval warning:', error);
    return null;
  }
}
