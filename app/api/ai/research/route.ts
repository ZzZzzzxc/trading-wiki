import { NextResponse } from 'next/server';
import { z } from 'zod';
import { researchAgent, type ResearchConfig } from '@/lib/ai/research-agent';

const schema = z.object({
  question: z.string().min(1, '问题不能为空'),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
  focus: z.enum(['comprehensive', 'technical', 'fundamental', 'news']).default('comprehensive'),
  debate: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const { question, depth, focus, debate } = schema.parse(await request.json());

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        function emit(type: string, data: unknown) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        }

        try {
          for await (const event of researchAgent(question, { depth, focus, debate })) {
            emit(event.type, event.data);
          }
        } catch (err) {
          emit('error', {
            message: err instanceof Error ? err.message : '未知错误',
          });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }

    return NextResponse.json({ ok: false, error: '研究启动失败' }, { status: 500 });
  }
}
