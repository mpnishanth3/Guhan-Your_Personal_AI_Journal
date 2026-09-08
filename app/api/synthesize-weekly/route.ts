import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { accessSecret } from '@/lib/secrets';

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { userId, clientDate, recentEntries } = body || {};

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "userId".' }, { status: 400 });
    }

    let project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

    if (!project) {
      try {
        project = await accessSecret('GOOGLE_CLOUD_PROJECT');
      } catch (e: any) {
        // ignore
      }
    }

    const ai = new GoogleGenAI({
      vertexai: true,
      project: project || undefined,
      location: location,
    });

    const todayStr = clientDate || new Date().toISOString().split('T')[0];

    // Format entries for synthesis
    const entriesList = Array.isArray(recentEntries) ? recentEntries : [];
    const formattedEntries = entriesList
      .slice(0, 15)
      .map((entry: any, index: number) => {
        const date = entry.date || entry.entry_date || entry.Entry_Date || 'Unknown Date';
        const mood = entry.mood_score ?? entry.Mood_Score ?? 'N/A';
        const text = entry.text || entry.original_prompt || entry.scrubbed_text || '';
        const tasks = entry.tasks || entry.actionable_tasks || entry.Actionable_Tasks;
        const tasksStr = Array.isArray(tasks) ? tasks.join(', ') : tasks;
        return `Entry ${index + 1} (${date}):
Mood Score: ${mood}
Reflection: ${text}${tasksStr ? `\nActionable Items: ${tasksStr}` : ''}`;
      })
      .join('\n\n');

    const systemInstruction = `You are Guhan, an empathetic sanctuary intelligence.
Current Date: ${todayStr}

Task:
Analyze the user's past week of reflections to formulate their overarching "Weekly Cognitive Anchor".
1. "cognitive_anchor": A comforting, profound, 1-2 sentence mindful anchor summarizing their mental/emotional state and providing an intentional focal point for clarity and calm.
2. "summary": A brief, reflective narrative summarizing the key thoughts, struggles, or breakthroughs of their week.
3. "theme": A single lowercase keyword capturing the dominant theme (e.g. 'resilience', 'calm', 'restoration', 'momentum', 'focus', 'clarity').
4. "mood_trend": A short phrase describing their trajectory (e.g. 'Ascending calm', 'Steadfast focus', 'Grounded resilience').

If the user has few or no entries provided, synthesize a gentle, universally grounding anchor focused on fresh beginnings and quiet contemplation.

Recent Reflections:
${formattedEntries || 'No recent entries provided for this week.'}`;

    const synthesisSchema = {
      type: Type.OBJECT,
      properties: {
        cognitive_anchor: {
          type: Type.STRING,
          description: 'A 1-2 sentence mindful focal point for clarity and calm.',
        },
        summary: {
          type: Type.STRING,
          description: 'A brief reflective narrative summarizing their week.',
        },
        theme: {
          type: Type.STRING,
          description: 'A single lowercase keyword capturing the dominant theme.',
        },
        mood_trend: {
          type: Type.STRING,
          description: 'Short phrase describing the emotional trajectory.',
        },
      },
      required: ['cognitive_anchor', 'summary', 'theme'],
    };

    let responseData: any = null;
    const models = [
      'gemini-2.5-flash',
      'gemini-3.5-flash',
    ];

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: 'Synthesize my Weekly Cognitive Anchor from the provided reflections.',
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: synthesisSchema,
            temperature: 0.2,
          },
        });
        responseData = JSON.parse(response.text || '{}');
        if (responseData && responseData.cognitive_anchor) break;
      } catch (err: any) {
        console.warn(`Weekly synthesis model ${model} attempt warning:`, err?.message || err);
      }
    }

    if (!responseData || !responseData.cognitive_anchor) {
      // Default sanctuary anchor if all models fail
      responseData = {
        cognitive_anchor: 'Find steady ground in this present moment; allow each thought to settle with gentle clarity.',
        summary: 'A period of quiet reflection and gentle grounding in the sanctuary.',
        theme: 'grounding',
        mood_trend: 'Steadfast calm',
      };
    }

    const weekId = `week_${todayStr}`;

    return NextResponse.json({
      success: true,
      synthesis: {
        cognitive_anchor: responseData.cognitive_anchor,
        summary: responseData.summary,
        theme: (responseData.theme || 'reflection').toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        mood_trend: responseData.mood_trend || 'Steadfast',
        date: todayStr,
        weekId,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Weekly Synthesis API Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to synthesize weekly anchor' },
      { status: 500 }
    );
  }
}
