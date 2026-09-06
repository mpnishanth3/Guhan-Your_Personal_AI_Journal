import { NextResponse } from 'next/server';
import { generateTextEmbedding } from '@/lib/embeddings';

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { text } = body || {};

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "text" field.' }, { status: 400 });
    }

    const embedding = await generateTextEmbedding(text);

    return NextResponse.json({
      success: true,
      dimensions: embedding.length,
      embedding,
    });
  } catch (error: any) {
    console.error('Embed API Route Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate embedding' },
      { status: 500 }
    );
  }
}
