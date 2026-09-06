import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { accessSecret } from '@/lib/secrets';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateTextEmbedding, cosineSimilarity } from '@/lib/embeddings';

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      prompt,
      contextEntries,
      userId,
      clientTime,
      clientLocalTime,
      clientDate,
      timeZone,
      timeZoneOffset,
    } = body || {};

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "prompt".' }, { status: 400 });
    }

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "userId".' }, { status: 400 });
    }

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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    // 1. Resolve user local time, date, and timezone offset
    let userLocalDate = typeof clientDate === 'string' ? clientDate.trim() : '';
    let userLocalClockTime = '';
    let userTzOffset = typeof timeZoneOffset === 'string' && timeZoneOffset.trim() ? timeZoneOffset.trim() : '+00:00';
    let userTimeZone = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC';

    if (clientLocalTime && typeof clientLocalTime === 'string') {
      const parts = clientLocalTime.split('T');
      if (!userLocalDate && parts[0]) userLocalDate = parts[0];
      if (parts[1]) userLocalClockTime = parts[1];
    }

    if (!userLocalDate || !userLocalClockTime) {
      const fallbackDate = clientTime ? new Date(clientTime) : new Date();
      if (!isNaN(fallbackDate.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        if (!userLocalDate) {
          userLocalDate = `${fallbackDate.getFullYear()}-${pad(fallbackDate.getMonth() + 1)}-${pad(fallbackDate.getDate())}`;
        }
        if (!userLocalClockTime) {
          userLocalClockTime = `${pad(fallbackDate.getHours())}:${pad(fallbackDate.getMinutes())}:${pad(fallbackDate.getSeconds())}`;
        }
      }
    }

    // 1. Generate 768-dimensional Query Embedding for Semantic Vector Search
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await generateTextEmbedding(prompt);
    } catch (embedErr) {
      console.warn('Query embedding generation warning:', embedErr);
    }

    // 2. Semantic Chat Retrieval: Query Firestore using findNearest() with in-memory fallback
    let semanticEntries: any[] = [];
    const hasAdminCredentials = Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.K_SERVICE
    );

    if (hasAdminCredentials && queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
      try {
        const adminDb = getAdminFirestore();
        const entriesRef = adminDb.collection('users').doc(userId).collection('entries');
        const vectorQuery = entriesRef.findNearest('embedding', FieldValue.vector(queryEmbedding), {
          limit: 5,
          distanceMeasure: 'COSINE',
        });
        const snap = await vectorQuery.get();
        snap.forEach((doc) => {
          semanticEntries.push({ id: doc.id, ...doc.data() });
        });
      } catch (findNearestError: any) {
        console.warn(
          '[CHAT API] findNearest notice (falling back to in-memory cosine ranking):',
          findNearestError?.message || findNearestError
        );
      }
    }

    // Fallback: If findNearest yielded 0 entries, rank candidate entries via cosine similarity or recent items
    if (semanticEntries.length === 0) {
      let allCandidateEntries: any[] = [];
      if (Array.isArray(contextEntries) && contextEntries.length > 0) {
        allCandidateEntries = contextEntries;
      } else if (hasAdminCredentials) {
        try {
          const adminDb = getAdminFirestore();
          const snap = await adminDb
            .collection('users')
            .doc(userId)
            .collection('entries')
            .orderBy('entry_date', 'desc')
            .limit(20)
            .get();
          snap.forEach((d) => allCandidateEntries.push({ id: d.id, ...d.data() }));
        } catch (adminFetchErr) {
          console.warn('Fallback entries fetch notice:', adminFetchErr);
        }
      }

      if (queryEmbedding && allCandidateEntries.length > 0) {
        const scored = allCandidateEntries.map((e) => {
          let eVec: number[] | null = null;
          if (e.embedding) {
            if (Array.isArray(e.embedding)) {
              eVec = e.embedding;
            } else if (typeof e.embedding.toArray === 'function') {
              eVec = e.embedding.toArray();
            } else if (Array.isArray(e.embedding._values)) {
              eVec = e.embedding._values;
            }
          }
          const score = eVec ? cosineSimilarity(queryEmbedding!, eVec) : 0;
          return { entry: e, score };
        });

        scored.sort((a, b) => b.score - a.score);
        semanticEntries = scored.slice(0, 5).map((s) => s.entry);
      } else {
        semanticEntries = allCandidateEntries.slice(0, 5);
      }
    }

    // 3. Format Context for Gemini Prompt Injection
    const formattedContext = semanticEntries
      .map((entry: any, index: number) => {
        const date = entry.Entry_Date || entry.entry_date || entry.date || 'Unknown Date';
        const mood = entry.Mood_Score ?? entry.mood_score ?? 'N/A';
        const text = entry.original_prompt || entry.scrubbed_text || '';
        const tasks = entry.Actionable_Tasks || entry.actionable_tasks;
        const tasksStr = Array.isArray(tasks) ? tasks.join(', ') : tasks;
        return `Entry ${index + 1} (Date: ${date}):
Mood Score: ${mood}
Journal: ${text}${tasksStr ? `\nActionable Tasks: ${tasksStr}` : ''}`;
      })
      .join('\n\n');

    const systemInstruction = `You are Guhan, an empathetic, secure reflection sanctuary assistant.
Current User Context:
- User Local Date: ${userLocalDate}
- User Local Time: ${userLocalClockTime}
- User Timezone: ${userTimeZone} (UTC offset: ${userTzOffset})

Task:
1. Determine if the user's message is a natural language REMINDER REQUEST (e.g. "Remind me to check the database at 5 PM", "Remind me to stretch every 2 hours", "Remind me to check analytics every other day", "Remind me every Friday at 5 PM to review logs", "Remind me today at 6am for jog").
2. If it is a reminder request:
   - Extract the concise task "title" (e.g., "Jog", "Check analytics", "Stretch", "Review logs").
   - Parse recurrence rules into the structured "recurrence" object:
     - "type": One of ['never', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'monthly', 'every_3_months', 'every_6_months', 'yearly', 'custom'].
     - Preset mappings:
       - "every hour" / "hourly" -> type: 'hourly'
       - "every day" / "daily" -> type: 'daily'
       - "on weekdays" / "Monday to Friday" / "every weekday" -> type: 'weekdays'
       - "on weekends" / "every weekend" -> type: 'weekends'
       - "every week" / "weekly" / "every Friday" -> type: 'weekly'
       - "every month" / "monthly" -> type: 'monthly'
       - "quarterly" / "every 3 months" -> type: 'every_3_months'
       - "semi-annually" / "every 6 months" -> type: 'every_6_months'
       - "every year" / "yearly" / "annually" -> type: 'yearly'
     - Custom interval mappings (e.g. "every other day", "every 2 hours", "every 3 weeks", "every 4 months"):
       - "every other day" / "every 2 days" -> type: 'custom', customFrequency: 'daily', customInterval: 2
       - "every 2 hours" -> type: 'custom', customFrequency: 'hourly', customInterval: 2
       - "every N hours/days/weeks/months/years" -> type: 'custom', customFrequency: frequency, customInterval: N
     - Non-recurring: type: 'never'.
   - Calculate "scheduled_time" in the user's local timezone (${userTzOffset}):
     - If the user explicitly says "today" (e.g. "today at 6am", "today at 6pm"): scheduled date MUST be today's date (${userLocalDate}), even if the time has already passed earlier today. Do NOT bump to tomorrow if the user wrote "today".
     - If the user explicitly says "tomorrow" (e.g. "tomorrow at 7am"): scheduled date MUST be tomorrow's date.
     - If the user specifies a time WITHOUT "today" or "tomorrow":
       - If that time has already passed today relative to Current User Local Time (${userLocalClockTime}), schedule for tomorrow at that time.
       - Otherwise, schedule for today at that time.
     - For relative intervals (e.g. "in 30 minutes", "in 2 hours"): add duration to Current User Local Time.
     - TIMEZONE FORMAT: "scheduled_time" MUST be formatted as an ISO 8601 string with the user's timezone offset:
       Format: YYYY-MM-DDTHH:mm:ss${userTzOffset}
       The HH:mm:ss in the string MUST match the user's requested local clock time (e.g. 06:00:00 for 6:00 AM, 18:00:00 for 6:00 PM). DO NOT convert to or append UTC 'Z'.
   - For "text", provide a comforting confirmation (e.g. "I have set a reminder for your jog today at 6:00 AM." or "I will gently remind you to stretch every 2 hours.").
   - Set "is_reminder": true.
3. If it is NOT a reminder request (e.g., general question about past reflections or feelings):
   - Answer empathetically based strictly on the provided Past Entries Context.
   - If past entries context is not relevant, gently respond from a supportive mindfulness stance.
   - Set "is_reminder": false.
   - Leave "reminder" as null.

Past Entries Context (Top 5 Semantic Matches from Vault):
${formattedContext || 'No past entries provided.'}`;

    const chatResponseSchema = {
      type: Type.OBJECT,
      properties: {
        is_reminder: {
          type: Type.BOOLEAN,
          description: 'Whether the user requested a reminder to be created.',
        },
        text: {
          type: Type.STRING,
          description: 'Response message to the user.',
        },
        reminder: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Task or reminder title.' },
            scheduled_time: {
              type: Type.STRING,
              description: 'Exact ISO 8601 datetime string with user timezone offset.',
            },
            recurrence: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description:
                    "Recurrence preset: 'never', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'monthly', 'every_3_months', 'every_6_months', 'yearly', or 'custom'.",
                },
                customFrequency: {
                  type: Type.STRING,
                  description:
                    "If custom: 'hourly', 'daily', 'weekly', 'monthly', or 'yearly'.",
                },
                customInterval: {
                  type: Type.INTEGER,
                  description: 'If custom: positive integer (e.g. 2 for every 2 hours/days).',
                },
              },
              required: ['type'],
            },
          },
          required: ['title', 'scheduled_time', 'recurrence'],
        },
      },
      required: ['is_reminder', 'text'],
    };

    let responseData: any = null;
    const models = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: chatResponseSchema,
          },
        });
        responseData = JSON.parse(response.text || '{}');
        if (responseData && responseData.text) break;
      } catch (err: any) {
        console.warn(`Chat model ${model} attempt warning:`, err?.message || err);
      }
    }

    if (!responseData) {
      // Fallback
      responseData = {
        is_reminder: false,
        text: 'I am here with you in the sanctuary. How can I help you reflect today?',
        reminder: null,
      };
    }

    // Normalize and sanitize reminder data
    if (responseData.reminder) {
      // 1. Sanitize scheduled_time
      if (responseData.reminder.scheduled_time) {
        let st = String(responseData.reminder.scheduled_time).trim();
        const isExplicitToday = /\btoday\b/i.test(prompt);

        // Match ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss
        const isoMatch = st.match(
          /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(?:Z|([+-]\d{2}:\d{2}))?$/
        );
        if (isoMatch) {
          let datePart = isoMatch[1];
          let timePart = isoMatch[2];
          if (timePart.length === 5) timePart += ':00';

          // If user explicitly asked for "today", enforce userLocalDate
          if (isExplicitToday && userLocalDate && datePart !== userLocalDate) {
            datePart = userLocalDate;
          }

          // Enforce user local timezone offset so browser doesn't skew hours
          st = `${datePart}T${timePart}${userTzOffset}`;
        } else if (!st.includes('+') && !st.includes('-') && !st.endsWith('Z')) {
          st = `${st}${userTzOffset}`;
        }

        responseData.reminder.scheduled_time = st;
      }

      // 2. Normalize recurrence object safely
      const validTypes = [
        'never',
        'hourly',
        'daily',
        'weekdays',
        'weekends',
        'weekly',
        'monthly',
        'every_3_months',
        'every_6_months',
        'yearly',
        'custom',
      ];
      let recType = 'never';
      if (responseData.reminder.recurrence) {
        if (typeof responseData.reminder.recurrence === 'string') {
          recType = responseData.reminder.recurrence.toLowerCase().trim();
        } else if (typeof responseData.reminder.recurrence === 'object') {
          recType = String(responseData.reminder.recurrence.type || 'never').toLowerCase().trim();
        }

        if (recType === 'none' || recType === 'never' || !recType) {
          responseData.reminder.recurrence = { type: 'never' };
        } else {
          // Check for pattern like "every_2_hours", "every_3_days", etc.
          const matchEvery = recType.match(
            /^every_(\d+)_(hour|hours|day|days|week|weeks|month|months|year|years)$/
          );
          if (matchEvery) {
            const interval = parseInt(matchEvery[1], 10) || 1;
            const rawUnit = matchEvery[2];
            let freq: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' = 'daily';
            if (rawUnit.startsWith('hour')) freq = 'hourly';
            else if (rawUnit.startsWith('day')) freq = 'daily';
            else if (rawUnit.startsWith('week')) freq = 'weekly';
            else if (rawUnit.startsWith('month')) freq = 'monthly';
            else if (rawUnit.startsWith('year')) freq = 'yearly';
            responseData.reminder.recurrence = {
              type: 'custom',
              customFrequency: freq,
              customInterval: interval,
            };
          } else if (recType === 'custom') {
            const validFreq = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'];
            const freq = String(
              responseData.reminder.recurrence.customFrequency || 'daily'
            ).toLowerCase().trim();
            responseData.reminder.recurrence.type = 'custom';
            responseData.reminder.recurrence.customFrequency = validFreq.includes(freq) ? freq : 'daily';
            responseData.reminder.recurrence.customInterval = Math.max(
              1,
              parseInt(responseData.reminder.recurrence.customInterval) || 1
            );
          } else {
            responseData.reminder.recurrence = {
              type: validTypes.includes(recType) ? recType : 'never',
            };
          }
        }
      } else {
        responseData.reminder.recurrence = { type: 'never' };
      }
    }

    return NextResponse.json({
      success: true,
      text: responseData.text,
      isReminder: Boolean(responseData.is_reminder && responseData.reminder),
      reminder: responseData.is_reminder ? responseData.reminder : null,
    });
  } catch (error: any) {
    console.error('[CHAT API ERROR]:', error?.message || error, error?.stack);
    if (error?.code) {
      console.error('[CHAT API FIREBASE ERROR CODE]:', error.code);
    }
    return NextResponse.json({
      success: true,
      text: 'I am here with you in the sanctuary. How can I help you reflect today?',
      isReminder: false,
      reminder: null,
    });
  }
}
