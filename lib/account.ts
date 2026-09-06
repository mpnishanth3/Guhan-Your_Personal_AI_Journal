import { db, storage } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { ref, listAll, deleteObject } from 'firebase/storage';
import { clearMediaVault } from '@/lib/media-vault';

/**
 * Total Data Eradication Routine:
 * 1. Firestore: Uses writeBatch to delete the core user document (users/{userId}),
 *    all documents in users/{userId}/entries subcollection, and any reminders or settings.
 * 2. Storage: Deletes the user's root folder in Firebase Storage (users/{userId}).
 * 3. Local Vault: Clears any IndexedDB cached media records.
 */
export async function eradicateUserData(userId: string): Promise<void> {
  if (!userId) return;

  // 1. Collect all Firestore document references under users/{userId}
  const entriesRef = collection(db, 'users', userId, 'entries');
  const entriesSnap = await getDocs(entriesRef);

  // Reminders subcollection (if exists)
  const remindersRef = collection(db, 'users', userId, 'reminders');
  const remindersSnap = await getDocs(remindersRef).catch(() => null);

  // Settings subcollection (if exists)
  const settingsRef = collection(db, 'users', userId, 'settings');
  const settingsSnap = await getDocs(settingsRef).catch(() => null);

  const allDocRefs = [
    ...entriesSnap.docs.map((d) => d.ref),
    ...(remindersSnap ? remindersSnap.docs.map((d) => d.ref) : []),
    ...(settingsSnap ? settingsSnap.docs.map((d) => d.ref) : []),
    doc(db, 'users', userId), // Core user document
  ];

  // Firestore allows up to 500 operations per writeBatch
  for (let i = 0; i < allDocRefs.length; i += 450) {
    const batch = writeBatch(db);
    const chunk = allDocRefs.slice(i, i + 450);
    chunk.forEach((dRef) => batch.delete(dRef));
    await batch.commit();
  }

  // 2. Storage: Purge root folder users/{userId} and all sub-items/folders
  try {
    async function deleteStorageFolder(folderPath: string) {
      const folderRef = ref(storage, folderPath);
      const res = await listAll(folderRef);
      await Promise.all(res.items.map((itemRef) => deleteObject(itemRef).catch(() => {})));
      await Promise.all(res.prefixes.map((prefixRef) => deleteStorageFolder(prefixRef.fullPath)));
    }
    await deleteStorageFolder(`users/${userId}`);
  } catch (storageErr) {
    console.warn('Storage eradication warning (continuing):', storageErr);
  }

  // 3. Clear local IndexedDB media vault
  try {
    await clearMediaVault();
  } catch (idbErr) {
    console.warn('IndexedDB clear warning (continuing):', idbErr);
  }
}
