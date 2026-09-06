const { parseCSVTokens, validateTwoColumnCSV } = require('./lib/csv');
const fs = require('fs');
const path = require('path');

const csvText = fs.readFileSync(path.join(__dirname, 'public/templates/journal_import_sample.csv'), 'utf8');

const result = validateTwoColumnCSV(csvText);
console.log(JSON.stringify(result, null, 2));

const parsed = parseCSVTokens(csvText);
console.log(JSON.stringify(parsed, null, 2));
