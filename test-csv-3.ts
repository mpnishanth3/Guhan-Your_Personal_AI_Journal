import { validateTwoColumnCSV } from './lib/csv';
import * as fs from 'fs';
import * as path from 'path';

// Let's create a browser-like File text
const csvText = `Date,Context\n2025-01-01,"Woke up early and felt energized. Read a book for an hour."\n2025-01-02,"Had a productive day at work. Finished the project proposal."\n2025-01-03,"Feeling a bit stressed about the upcoming deadline, need to take a break."\n`;

const result = validateTwoColumnCSV(csvText);
console.log(result);
