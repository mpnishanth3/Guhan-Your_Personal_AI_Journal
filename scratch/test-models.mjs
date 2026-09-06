import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey && fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  const match = envContent.match(/GEMINI_API_KEY=(.*)/);
  if (match) apiKey = match[1].trim();
}

const ai = new GoogleGenAI({ apiKey });

const candidateModels = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest'
];

for (const model of candidateModels) {
  try {
    console.log(`Testing model: ${model}...`);
    const res = await ai.models.generateContent({
      model,
      contents: 'Hello, reply with "OK".'
    });
    console.log(`SUCCESS for ${model}:`, res.text?.trim());
  } catch (err) {
    console.error(`FAIL for ${model}:`, err.message || err);
  }
}
