import { format, parseISO, isValid } from 'date-fns';

import Papa from 'papaparse';

export interface RawCSVEntry {
  date: string; // Formatted YYYY-MM-DD
  context: string;
}

export interface TwoColumnParseResult {
  validEntries: RawCSVEntry[];
  totalRows: number;
  skippedCount: number;
  errors: string[];
}

export interface BulkImportRow {
  date: string; // YYYY-MM-DD
  content: string; // Reflection text
  manualMood: number; // Integer 1-10
}

export interface BulkImportParseResult {
  isValid: boolean;
  errorMessage?: string;
  rows: BulkImportRow[];
}

export const CSV_SCHEMA_ERROR_MESSAGE = 'Invalid format. Required: date, content, manual_mood.';

/**
 * Robust RFC 4180 compliant CSV parser.
 * Correctly handles multiline text, escaped double quotes (""), and commas inside quoted fields.
 */
export function parseCSVTokens(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped double quote
          currentCell += '"';
          i++;
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.toLowerCase().trim().replace(/^["']|["']$/g, ''));
  return { headers, rows: rows.slice(1) };
}

/**
 * Robust CSV Schema Validator using PapaParse:
 * Sanitizes headers against BOM (\uFEFF), whitespace, and casing.
 * Strictly demands keys: ['date', 'content', 'manual_mood'].
 * Coerces date (slashes to dashes) and manual_mood (int 1-10, defaulting NaN to 5).
 */
export function validateBulkImportCSV(csvText: string): BulkImportParseResult {
  if (!csvText || !csvText.trim()) {
    return {
      isValid: false,
      errorMessage: 'Invalid format. Required: date, content, manual_mood. Found: none',
      rows: [],
    };
  }

  const parseResult = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().toLowerCase().replace(/^\uFEFF/, ''),
  });

  const parsedData = (parseResult.data || []) as Record<string, any>[];
  const headers = Object.keys(parsedData[0] || {});
  const requiredKeys = ['date', 'content', 'manual_mood'];
  const hasAllRequiredKeys = requiredKeys.every((key) => headers.includes(key));

  if (parsedData.length === 0 || !hasAllRequiredKeys) {
    const foundStr = headers.length > 0 ? headers.join(', ') : 'none';
    return {
      isValid: false,
      errorMessage: `Invalid format. Required: date, content, manual_mood. Found: ${foundStr}`,
      rows: [],
    };
  }

  const validRows: BulkImportRow[] = [];

  for (const row of parsedData) {
    if (!row) continue;

    const rawContent = (row.content ?? '').toString().trim();
    if (!rawContent) continue; // Skip rows where reflection content is blank

    // Ensure manual_mood is cast to an integer: parseInt(row.manual_mood, 10). If it is NaN, default it to 5 (Grounded).
    const parsedMood = parseInt(row.manual_mood, 10);
    const manualMood = isNaN(parsedMood) ? 5 : Math.max(1, Math.min(10, parsedMood));

    // Ensure the date string is properly formatted (e.g., replacing slashes with dashes if necessary).
    let dateStr = (row.date ?? '').toString().trim().replace(/\//g, '-');

    // Normalize localized DD-MM-YYYY or D-M-YYYY to YYYY-MM-DD
    const localizedMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (localizedMatch) {
      const [, d, m, y] = localizedMatch;
      dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // Normalize YYYY-M-D to YYYY-MM-DD
    const yyyymdMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyymdMatch) {
      const [, y, m, d] = yyyymdMatch;
      dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    // Fallback if not valid YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateStr = format(new Date(), 'yyyy-MM-dd');
    }

    validRows.push({
      date: dateStr,
      content: rawContent,
      manualMood,
    });
  }

  if (validRows.length === 0) {
    const foundStr = headers.length > 0 ? headers.join(', ') : 'none';
    return {
      isValid: false,
      errorMessage: `Invalid format. Required: date, content, manual_mood. Found: ${foundStr}`,
      rows: [],
    };
  }

  return {
    isValid: true,
    rows: validRows,
  };
}

/**
 * Validates incoming two-column CSV:
 * Strictly two headers: "Date" and "Context".
 * Validates each row to ensure a valid date string and non-empty reflection body.
 */
export function validateTwoColumnCSV(csvText: string): TwoColumnParseResult {
  const { headers, rows } = parseCSVTokens(csvText);

  if (headers.length === 0 || rows.length === 0) {
    return {
      validEntries: [],
      totalRows: 0,
      skippedCount: 0,
      errors: ['The selected CSV file is empty or missing data rows.'],
    };
  }

  // Strictly validate that headers match Date and Context
  if (headers.length !== 2) {
    return {
      validEntries: [],
      totalRows: rows.length,
      skippedCount: rows.length,
      errors: [
        `CSV must contain strictly two headers: Date and Context. Detected ${headers.length} headers: [${headers.join(', ')}]. First row sample: ${JSON.stringify(rows[0])}`,
      ],
    };
  }

  const dateColIdx = headers.indexOf('date');
  const contextColIdx = headers.indexOf('context');

  if (dateColIdx === -1 || contextColIdx === -1) {
    return {
      validEntries: [],
      totalRows: rows.length,
      skippedCount: rows.length,
      errors: [
        `CSV headers must strictly be "Date" and "Context". Detected headers: [${headers.join(', ')}].`,
      ],
    };
  }

  const validEntries: RawCSVEntry[] = [];
  let skippedCount = 0;

  rows.forEach((row) => {
    const rawDate = row[dateColIdx]?.trim();
    const rawContext = row[contextColIdx]?.trim();

    // 1. Non-empty reflection body validation
    if (!rawContext || rawContext.length === 0) {
      skippedCount++;
      return;
    }

    // 2. Date string validation
    let normalizedDate = rawDate;
    if (normalizedDate) {
      // Autonomously normalize localized DD-MM-YYYY or DD/MM/YYYY to YYYY-MM-DD
      const localizedMatch = normalizedDate.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (localizedMatch) {
        const [, day, month, year] = localizedMatch;
        normalizedDate = `${year}-${month}-${day}`;
      }
    }

    let parsedDate: Date | null = null;
    if (normalizedDate) {
      try {
        const iso = parseISO(normalizedDate);
        if (isValid(iso)) {
          parsedDate = iso;
        }
      } catch {
        parsedDate = null;
      }

      if (!parsedDate || !isValid(parsedDate)) {
        const standard = new Date(normalizedDate);
        if (isValid(standard)) {
          parsedDate = standard;
        }
      }
    }

    if (!parsedDate || !isValid(parsedDate)) {
      skippedCount++;
      return;
    }

    const formattedDate = format(parsedDate, 'yyyy-MM-dd');
    validEntries.push({
      date: formattedDate,
      context: rawContext,
    });
  });

  if (validEntries.length === 0 && rows.length > 0) {
    // Add debugging info if everything was skipped
    const sampleRow = rows[0] || [];
    return {
      validEntries,
      totalRows: rows.length,
      skippedCount,
      errors: [
        `Parsed ${rows.length} row(s), but none had valid dates and non-empty reflection text. Sample parsed row: Date="${sampleRow[dateColIdx]}", Context="${sampleRow[contextColIdx]}"`
      ],
    };
  }

  return {
    validEntries,
    totalRows: rows.length,
    skippedCount,
    errors: [],
  };
}

/**
 * Escapes a single cell according to RFC 4180
 */
function escapeCSVField(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes records with all fields:
 * Date, Context, Mood_Score, Manual_Mood_Score, Actionable_Tasks, Timestamp, Tags
 */
export function serializeVaultEntriesToCSV(entries: any[]): string {
  const headers = ['Date', 'Context', 'Mood_Score', 'Manual_Mood_Score', 'Actionable_Tasks', 'Timestamp', 'Tags'];

  const rows = entries.map((entry) => {
    // 1. Date
    let dateVal = '';
    if (entry.entry_date) {
      dateVal = entry.entry_date;
    } else if (entry.createdAt?.toDate) {
      dateVal = format(entry.createdAt.toDate(), 'yyyy-MM-dd');
    }

    // 2. Context
    const contextVal = entry.original_prompt || entry.scrubbed_text || '';

    // 3. Mood_Score (AI)
    const rawAi = typeof entry.Mood_Score === 'number'
      ? entry.Mood_Score
      : typeof entry.mood_score === 'number'
      ? entry.mood_score
      : '';
    const moodScoreVal = rawAi !== '' ? String(rawAi) : '';

    // 4. Manual_Mood_Score (Self-assessment)
    const rawManual = typeof entry.Manual_Mood_Score === 'number'
      ? entry.Manual_Mood_Score
      : typeof entry.manual_mood_score === 'number'
      ? entry.manual_mood_score
      : '';
    const manualMoodScoreVal = rawManual !== '' ? String(rawManual) : '';

    // 5. Actionable_Tasks
    let tasksVal = '';
    if (Array.isArray(entry.actionable_tasks)) {
      tasksVal = entry.actionable_tasks.join('; ');
    } else if (typeof entry.actionable_tasks === 'string') {
      tasksVal = entry.actionable_tasks;
    }

    // 6. Timestamp
    let timestampVal = '';
    if (entry.Timestamp) {
      timestampVal = entry.Timestamp;
    } else if (entry.createdAt?.toDate) {
      timestampVal = entry.createdAt.toDate().toISOString();
    }

    // 7. Tags
    let tagsVal = '';
    if (Array.isArray(entry.tags)) {
      tagsVal = entry.tags.join(', ');
    } else if (typeof entry.tags === 'string') {
      tagsVal = entry.tags;
    }

    return [
      escapeCSVField(dateVal),
      escapeCSVField(contextVal),
      escapeCSVField(moodScoreVal),
      escapeCSVField(manualMoodScoreVal),
      escapeCSVField(tasksVal),
      escapeCSVField(timestampVal),
      escapeCSVField(tagsVal),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}
