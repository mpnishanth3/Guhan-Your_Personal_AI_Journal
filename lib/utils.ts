import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const MANUAL_MOOD_SCALE: Record<number, string> = {
  1: 'Overwhelmed',
  2: 'Struggling',
  3: 'Disconnected',
  4: 'Drained',
  5: 'Grounded',
  6: 'Calm',
  7: 'Content',
  8: 'Engaged',
  9: 'Energized',
  10: 'Thriving',
};

export function getManualMoodLabel(score?: number | null): string {
  if (typeof score !== 'number' || isNaN(score)) return 'Unrated';
  return MANUAL_MOOD_SCALE[score] || 'Unrated';
}

