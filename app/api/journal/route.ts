import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { accessSecret } from '@/lib/secrets';
import { getStorageMediaBuffer } from '@/lib/firebase-admin';
import { generateTextEmbedding } from '@/lib/embeddings';

// Schema validation for incoming request
type JournalRequest = {
  prompt?: string;
  userId?: string;
  entryDate?: string;
  mediaPath?: string;
  mediaMimeType?: string;
  mediaBase64?: string;
};

// Helper to strip undefined values before persistence/return
function stripUndefined(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefined(v)])
  );
}

// Helper for dynamic model fallback ladder supporting multimodal contents
async function generateContentWithFallback(
  ai: GoogleGenAI,
  contents: any,
  config?: any,
  prefer15Flash = false
) {
  const models = prefer15Flash
    ? ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']
    : ['gemini-3.6-flash', 'gemini-1.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config,
      });
      return response.text;
    } catch (error: any) {
      console.warn(`Model ${model} failed:`, error?.message || error);
      lastError = error;

      // Stop attempting fallbacks if error is definitely unrecoverable client-side (400)
      if (error?.status === 400) {
        throw error;
      }
    }
  }

  throw new Error(`All models in fallback ladder failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

export async function POST(req: Request) {
  try {
    // 1. Request Deserialization
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const data: JournalRequest = body && typeof body === 'object' ? body : {};

    // 2. Input Validation
    if (!data.prompt || typeof data.prompt !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "prompt" in request body.' }, { status: 400 });
    }

    if (!data.userId || typeof data.userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "userId" in request body for context boundary validation.' },
        { status: 400 }
      );
    }

    // 3. Dynamic Secret Retrieval
    let apiKey: string;
    try {
      apiKey = process.env.GEMINI_API_KEY || (await accessSecret('GEMINI_API_KEY'));
    } catch (e: any) {
      console.error('Secret Manager Error:', e);
      return NextResponse.json({ error: 'Failed to retrieve AI credentials' }, { status: 500 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'AI credentials missing or unavailable' }, { status: 500 });
    }

    // 4. Initialize Gemini API Client
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    // 5. PII Sanitizer Agent
    const sanitizerInstruction =
      'You are a PII Redaction Agent. Scrub the following text of any real names, phone numbers, and addresses. Replace them with [REDACTED]. Return ONLY the scrubbed text without markdown or commentary.';
    let scrubbedText = data.prompt;
    try {
      const sanitized = await generateContentWithFallback(ai, data.prompt, {
        systemInstruction: sanitizerInstruction,
      });
      if (sanitized?.trim()) {
        scrubbedText = sanitized.trim();
      }
    } catch (piiErr) {
      console.warn('PII scrubbing fallback to original prompt:', piiErr);
    }

    // 6. Multimodal Zero-Trust Media Preparation
    let inlineDataPart: { inlineData: { mimeType: string; data: string } } | null = null;

    if (data.mediaPath) {
      try {
        // Securely fetch buffer from isolated Firebase Storage via Admin SDK (never public URL)
        const mediaResult = await getStorageMediaBuffer(data.mediaPath);
        if (mediaResult?.buffer) {
          const base64Data = mediaResult.buffer.toString('base64');
          inlineDataPart = {
            inlineData: {
              mimeType: data.mediaMimeType || mediaResult.mimeType || 'image/jpeg',
              data: base64Data,
            },
          };
        } else if (data.mediaBase64) {
          // Client provided fallback buffer
          inlineDataPart = {
            inlineData: {
              mimeType: data.mediaMimeType || 'image/jpeg',
              data: data.mediaBase64,
            },
          };
        }
      } catch (mediaFetchError) {
        console.warn('Media buffer retrieval error, proceeding with text analysis:', mediaFetchError);
      }
    } else if (data.mediaBase64) {
      inlineDataPart = {
        inlineData: {
          mimeType: data.mediaMimeType || 'image/jpeg',
          data: data.mediaBase64,
        },
      };
    }

    // 7. Structured Analyst Agent & Synthesis (Few-Shot Constraint Formatting with Zero-Action Bypass)
    const isMultimodal = Boolean(inlineDataPart);
    const baseSystemPrompt = `You are Guhan, a highly analytical and empathetic digital sanctuary assistant. Your job is to analyze the user's journal entry and extract 1 to 3 highly specific, actionable micro-tasks. IF the entry is purely observational, emotional venting, or historical with no logical follow-up, you MUST return an empty array for tasks.

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
- Evaluate emotional tone as an integer "mood_score" between 1 and 10.
- Provide an empathetic, comforting insight in "response_text".
- Assign 1 to 3 relevant hashtags in "tags".
- If the reflection contains any time-sensitive intentions, future commitments, or scheduled tasks (e.g., "I need to review the logs tomorrow morning"), extract them into the reminders array with an estimated ISO 8601 scheduled_time relative to now or entry date. If no time-sensitive commitments are present, return an empty reminders array.`;

    const analystInstruction = isMultimodal
      ? `${baseSystemPrompt}\nVisual media is also attached: synthesize how the imagery contextualizes the reflection.`
      : baseSystemPrompt;

    const synthesisSchema = {
      type: Type.OBJECT,
      properties: {
        response_text: {
          type: Type.STRING,
          description: 'Empathetic, comforting reflection insight from Guhan.',
        },
        mood_score: {
          type: Type.INTEGER,
          description: 'Emotional sentiment rating between 1 and 10.',
        },
        actionable_tasks: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Constructive, practical next steps.',
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '1 to 3 relevant hashtags starting with #.',
        },
        reminders: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Concise description of the time-sensitive intention.',
              },
              scheduled_time: {
                type: Type.STRING,
                description: 'Estimated ISO 8601 datetime string for when this task is due.',
              },
              recurrence: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description:
                      "Recurrence preset: 'never', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'monthly', 'every_3_months', 'every_6_months', 'yearly', or 'custom'.",
                  },
                  customFrequency: { type: Type.STRING },
                  customInterval: { type: Type.INTEGER },
                },
                required: ['type'],
              },
            },
            required: ['title', 'scheduled_time'],
          },
          description: 'Time-sensitive intentions extracted from the reflection.',
        },
      },
      required: ['response_text', 'mood_score', 'actionable_tasks'],
    };

    let analystResult: any = null;

    // First attempt multimodal if media is present (using gemini-1.5-flash)
    if (isMultimodal && inlineDataPart) {
      try {
        const multimodalPayload: any[] = [scrubbedText, inlineDataPart];
        const rawResponse = await generateContentWithFallback(
          ai,
          multimodalPayload,
          {
            systemInstruction: analystInstruction,
            responseMimeType: 'application/json',
            responseSchema: synthesisSchema,
            temperature: 0.15,
          },
          true // prefer gemini-1.5-flash
        );
        analystResult = JSON.parse(rawResponse || '{}');
      } catch (mmError) {
        console.warn('Multimodal synthesis failed or timed out, falling back to text-only analysis:', mmError);
        analystResult = null;
      }
    }

    // Text-only fallback if multimodal wasn't used or failed
    if (!analystResult) {
      try {
        const rawResponse = await generateContentWithFallback(
          ai,
          scrubbedText,
          {
            systemInstruction: analystInstruction,
            responseMimeType: 'application/json',
            responseSchema: synthesisSchema,
            temperature: 0.15,
          },
          true // prefer gemini-1.5-flash
        );
        analystResult = JSON.parse(rawResponse || '{}');
      } catch (textError) {
        console.error('Synthesis parsing failure:', textError);
        analystResult = {
          response_text: 'I have safely sealed your thoughts within the vault.',
          mood_score: 6,
          actionable_tasks: [],
          tags: ['#sanctuary', '#mindfulness'],
          reminders: [],
        };
      }
    }

    // Normalize results
    const moodScore = typeof analystResult.mood_score === 'number'
      ? Math.max(1, Math.min(10, Math.round(analystResult.mood_score)))
      : 6;

    const rawTasks: string[] = Array.isArray(analystResult.actionable_tasks)
      ? analystResult.actionable_tasks
      : typeof analystResult.actionable_tasks === 'string' && analystResult.actionable_tasks.trim()
      ? analystResult.actionable_tasks.split(';').map((t: string) => t.trim()).filter(Boolean)
      : [];
    const actionableTasks: string[] = rawTasks.filter((t: string) => t && t.trim().length > 0);

    const tags: string[] = Array.isArray(analystResult.tags)
      ? analystResult.tags.map((t: string) => (t.startsWith('#') ? t : `#${t}`))
      : ['#reflection'];

    const reminders: Array<{ title: string; scheduled_time: string }> = Array.isArray(analystResult.reminders)
      ? analystResult.reminders.filter((r: any) => r && typeof r.title === 'string' && r.scheduled_time)
      : [];

    // 7.5. Generate 768-dimensional Vector Embedding of Content + Actionable_Tasks
    let embedding: number[] | null = null;
    try {
      const textToEmbed = `${scrubbedText}${
        actionableTasks.length > 0 ? '\n\nActionable Next Steps:\n' + actionableTasks.join('\n') : ''
      }`;
      embedding = await generateTextEmbedding(textToEmbed);
    } catch (embedErr) {
      console.warn('Vector embedding generation warning in /api/journal:', embedErr);
    }

    // 8. Clean Payload
    const cleanPayload = stripUndefined({
      success: true,
      original_prompt_length: data.prompt.length,
      scrubbed_text: scrubbedText,
      multimodal_analyzed: Boolean(isMultimodal && inlineDataPart),
      embedding,
      analysis: {
        response_text: analystResult.response_text || 'Your reflection is securely preserved in the vault.',
        mood_score: moodScore,
        actionable_tasks: actionableTasks.length > 0 ? actionableTasks : null,
        tags: tags,
        reminders: reminders,
      },
    });

    return NextResponse.json(cleanPayload);
  } catch (error: any) {
    console.error('Journal Synthesis API Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error' },
      { status: error?.status || 500 }
    );
  }
}
