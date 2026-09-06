import { parseCSVTokens, validateTwoColumnCSV } from './lib/csv';
import * as fs from 'fs';
import * as path from 'path';

const csvText = fs.readFileSync(path.join(__dirname, 'public/templates/journal_import_sample.csv'), 'utf8');

const result = validateTwoColumnCSV(csvText);
console.log("Validation Result:", JSON.stringify(result, null, 2));

const parsed = parseCSVTokens(csvText);
console.log("Parsed Tokens:", JSON.stringify(parsed, null, 2));
