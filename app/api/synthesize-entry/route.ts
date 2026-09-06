import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { accessSecret } from '@/lib/secrets';

// Fallback ladder across available Gemini models
async function generateWithFallback(ai: GoogleGenAI, contents: string, config: any) {
  const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      return response.text;
    } catch (err: any) {
      console.warn(`Model ${model} synthesis attempt failed:`, err?.message || err);
      lastError = err;
      if (err?.status === 400) throw err;
    }
  }

  throw new Error(`Synthesis ladder failed: ${lastError?.message || 'All models exhausted'}`);
}

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { prompt, date, userId } = body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty "prompt" (context).' }, { status: 400 });
    }

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "userId".' }, { status: 400 });
    }

    // Retrieve API credentials
    let apiKey: string;
    try {
      apiKey = process.env.GEMINI_API_KEY || (await accessSecret('GEMINI_API_KEY'));
    } catch (e: any) {
      console.error('Secret Manager Error:', e);
      return NextResponse.json({ error: 'Failed to retrieve AI credentials' }, { status: 500 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'AI credentials unavailable' }, { status: 500 });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    // 1. PII Scrubbing
    const sanitizerPrompt = `You are a PII Redaction Agent for a private personal journal. Scrub any real names, phone numbers, email addresses, and physical street addresses from the following text by replacing them with [REDACTED]. Return ONLY the scrubbed text without adding quotes or conversational preamble.\n\nText:\n${prompt}`;
    
    let scrubbedText = '';
    try {
      const sanitized = await generateWithFallback(ai, sanitizerPrompt, {});
      scrubbedText = sanitized?.trim() || prompt;
    } catch {
      scrubbedText = prompt;
    }

    // 2. Structured Guhan Synthesis (Few-Shot Constraint Formatting with Zero-Action Bypass)
    const systemInstruction = `You are Guhan, a highly analytical and empathetic digital sanctuary assistant. Your job is to analyze the user's journal entry and extract 1 to 3 highly specific, actionable micro-tasks. IF the entry is purely observational, emotional venting, or historical with no logical follow-up, you MUST return an empty array for tasks.

STRICT RULES FOR ACTIONABLE TASKS:
1. OPTIONALITY: Do not invent tasks if none are naturally required. Return [] instead.
2. NO PLATITUDES: Never say "Take a break" or "Focus on mental health".
3. BE ULTRA-SPECIFIC: Anchor the task to an exact project, feeling, or event mentioned.
4. MICRO-SCOPE: The task must be completable in under 30 minutes.
5. ACTION VERBS: Start every task with a strong verb (e.g., Draft, Review, Schedule).
6. COGNITIVE LOAD TAG MANDATE: Every task MUST begin with one of these exact tags: [Deep Work], [Frictionless], or [Anti-Task]. Example: [Frictionless] Reply to the API access email.

EXAMPLES:
- User Input: "Struggled with OAuth for 4 hours." -> ✅ Task: ["[Anti-Task] Step away for 20 minutes to rest your eyes before looking at the OAuth logic again."]
- User Input: "Need to finish drafting the PR specification." -> ✅ Task: ["[Deep Work] Draft the architecture section for the PR specification."]
- User Input: "Have to send the contract to Alice." -> ✅ Task: ["[Frictionless] Email the signed contract PDF to Alice."]
- User Input: "Today was a quiet, peaceful Sunday. I just sat on the porch." -> ✅ Task: [] (No action needed)

ADDITIONAL INSTRUCTIONS:
Synthesize the reflection into structured JSON:
1. "mood_score": An integer from 1 to 10 (1 = deeply distressed/overwhelmed, 5 = neutral/steady, 10 = peak euphoria/thriving).
2. "actionable_tasks": An array of strings containing 0 to 3 micro-tasks (or empty array [] if none required).
3. "tags": An array of 1 to 3 relevant contextual hashtags starting with '#'.`;

    const synthesisRaw = await generateWithFallback(ai, scrubbedText, {
      systemInstruction,
      temperature: 0.15,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mood_score: {
            type: Type.INTEGER,
            description: 'Emotional sentiment rating between 1 and 10.',
          },
          actionable_tasks: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '0 to 3 constructive micro-tasks, or empty array if none required.',
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '1 to 3 contextual hashtags starting with #.',
          },
        },
        required: ['mood_score', 'actionable_tasks', 'tags'],
      },
    });

    let result: { mood_score: number; actionable_tasks: string[] | string; tags: string[] };
    try {
      result = JSON.parse(synthesisRaw || '{}');
    } catch {
      result = {
        mood_score: 6,
        actionable_tasks: [],
        tags: ['#reflection'],
      };
    }

    // Ensure mood_score is integer 1-10
    let moodScore = typeof result.mood_score === 'number' ? Math.round(result.mood_score) : 6;
    if (moodScore < 1) moodScore = 1;
    if (moodScore > 10) moodScore = 10;

    // Ensure actionable_tasks is normalized without fallback strings
    let tasksStr = '';
    if (Array.isArray(result.actionable_tasks)) {
      const valid = result.actionable_tasks.map((t) => String(t).trim()).filter(Boolean);
      tasksStr = valid.length > 0 ? valid.join('; ') : '';
    } else if (typeof result.actionable_tasks === 'string' && result.actionable_tasks.trim()) {
      tasksStr = result.actionable_tasks.trim();
    }

    // Ensure tags are array of 1-3 hashtags
    let tagsList: string[] = [];
    if (Array.isArray(result.tags)) {
      tagsList = result.tags
        .map((t) => {
          let str = String(t).trim();
          if (!str.startsWith('#')) str = `#${str}`;
          return str.replace(/\s+/g, '');
        })
        .filter((t) => t.length > 1)
        .slice(0, 3);
    }
    if (tagsList.length === 0) {
      tagsList = ['#reflection'];
    }

    return NextResponse.json({
      success: true,
      scrubbed_text: scrubbedText,
      mood_score: moodScore,
      actionable_tasks: tasksStr || null,
      tags: tagsList,
    });
  } catch (error: any) {
    console.error('Synthesis Pipeline Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Synthesis pipeline encountered an error' },
      { status: 500 }
    );
  }
}
