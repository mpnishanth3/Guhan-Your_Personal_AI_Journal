import { parseISO, isValid } from 'date-fns';

function testDate(rawDate: string) {
  let parsedDate: Date | null = null;
  if (rawDate) {
    try {
      const iso = parseISO(rawDate);
      if (isValid(iso)) {
        parsedDate = iso;
      }
    } catch {
      parsedDate = null;
    }

    if (!parsedDate || !isValid(parsedDate)) {
      const standard = new Date(rawDate);
      if (isValid(standard)) {
        parsedDate = standard;
      }
    }
  }
  
  console.log(`raw: ${rawDate}, valid: ${parsedDate ? isValid(parsedDate) : false}`);
}

testDate('"2025-01-01"');
testDate('2025-01-01 ');
