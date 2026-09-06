import { GoogleGenAI } from '@google/genai';
import { accessSecret } from '@/lib/secrets';

/**
 * Generates a 768-dimensional vector embedding for a given text string using Google Gen AI.
 * Implements fallback across embedding models (text-embedding-004 -> gemini-embedding-001 -> gemini-embedding-2).
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) {
    return new Array(768).fill(0);
  }

  let apiKey: string;
  try {
    apiKey = process.env.GEMINI_API_KEY || (await accessSecret('GEMINI_API_KEY'));
  } catch (e: any) {
    console.error('Secret Manager Error in generateTextEmbedding:', e);
    throw new Error('Failed to retrieve AI credentials for embedding generation');
  }

  if (!apiKey) {
    throw new Error('AI credentials missing or unavailable');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const models = ['text-embedding-004', 'gemini-embedding-001', 'gemini-embedding-2'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.embedContent({
        model,
        contents: text,
        config: {
          outputDimensionality: 768,
        },
      });

      const values =
        (response as any)?.embeddings?.[0]?.values ||
        (response as any)?.embedding?.values;

      if (Array.isArray(values) && values.length > 0) {
        return values.slice(0, 768);
      }
    } catch (err: any) {
      lastError = err;
      // Continue to fallback model on 404 or transient error
    }
  }

  console.warn('Embedding model ladder exhausted:', lastError?.message || lastError);
  throw new Error(`Failed to generate vector embedding: ${lastError?.message || 'All models failed'}`);
}

/**
 * Computes cosine similarity between two vector arrays.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
