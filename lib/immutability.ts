/**
 * Immutability & Grace Period Utility for Guhan Sanctuary
 * Decouples logical Entry_Date from system Created_At timestamp.
 * Enforces a 7-day editing/deletion grace period strictly from document creation time.
 */

export interface EntryLockStatus {
  isLocked: boolean;
  canEditOrDelete: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  remainingText: string;
  createdDate: Date | null;
  logicalDate: string;
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Extracts a normalized Date object from an entry's Created_At / createdAt timestamp.
 */
export function getEntryCreatedDate(entry: any): Date | null {
  if (!entry) return null;
  const raw = entry.Created_At || entry.createdAt;
  if (!raw) return null;

  if (typeof raw.toDate === 'function') {
    return raw.toDate();
  }
  if (raw instanceof Date) {
    return raw;
  }
  if (typeof raw.seconds === 'number') {
    return new Date(raw.seconds * 1000);
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Extracts the normalized logical date (e.g. "2025-12-08") from an entry.
 */
export function getEntryLogicalDate(entry: any): string {
  if (!entry) return '';
  if (entry.Entry_Date && typeof entry.Entry_Date === 'string') {
    return entry.Entry_Date;
  }
  if (entry.entry_date && typeof entry.entry_date === 'string') {
    return entry.entry_date;
  }
  const created = getEntryCreatedDate(entry);
  if (created) {
    return created.toISOString().split('T')[0];
  }
  return '';
}

/**
 * Calculates whether an entry is within its 7-day grace period based on Created_At.
 * Guaranteed to NOT depend on Entry_Date.
 */
export function getEntryLockStatus(entry: any): EntryLockStatus {
  const logicalDate = getEntryLogicalDate(entry);
  const createdDate = getEntryCreatedDate(entry);

  // If no creation timestamp exists, treat as new/open
  if (!createdDate) {
    return {
      isLocked: false,
      canEditOrDelete: true,
      daysRemaining: 7,
      hoursRemaining: 168,
      remainingText: '7 days left in grace period',
      createdDate: null,
      logicalDate,
    };
  }

  const now = Date.now();
  const createdTime = createdDate.getTime();
  const elapsedMs = now - createdTime;

  if (elapsedMs >= SEVEN_DAYS_MS) {
    return {
      isLocked: true,
      canEditOrDelete: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      remainingText: 'Permanently sealed (7-day lock expired)',
      createdDate,
      logicalDate,
    };
  }

  const remainingMs = SEVEN_DAYS_MS - elapsedMs;
  const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.ceil(remainingMs / (60 * 60 * 1000));

  let remainingText = '';
  if (daysRemaining > 1) {
    remainingText = `${daysRemaining} days left in grace period`;
  } else if (hoursRemaining > 1) {
    remainingText = `${hoursRemaining} hours left in grace period`;
  } else {
    remainingText = 'Grace period ends shortly';
  }

  return {
    isLocked: false,
    canEditOrDelete: true,
    daysRemaining,
    hoursRemaining,
    remainingText,
    createdDate,
    logicalDate,
  };
}

/**
 * Validates if an import batch is under 7 days old and eligible for 1-click revert.
 */
export function isImportBatchRevertible(batchCreatedAt: Date | null): boolean {
  if (!batchCreatedAt) return false;
  const elapsed = Date.now() - batchCreatedAt.getTime();
  return elapsed < SEVEN_DAYS_MS;
}
