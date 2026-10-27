import { TripIdParamsSchema, type ProgressEvent } from "@/lib/schemas";
import { badRequest, notFound, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
/** 비정상적으로 오래 걸리는 작업에서 연결이 무한히 유지되지 않도록 상한을 둔다 (클라이언트는 retry로 재연결). */
const MAX_STREAM_MS = 5 * 60_000;

const isTerminal = (e: ProgressEvent) => e.status === "done" || e.status === "failed";

/**
 * GET /api/v1/trips/{id}/events — 진행 상황 SSE.
 * 작업 상태가 DB에 있으므로 복제본이 바뀌어도 이어서 구독할 수 있다. 변경이 있을 때만 progress 이벤트를 보낸다.
 */
export const GET = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const parsed = TripIdParamsSchema.safeParse(await params);
  if (!parsed.success) return badRequest(parsed.error);
  const { id } = parsed.data;

  const first = await tripRepo.getProgress(id);
  if (!first) return notFound("여행");

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      write("retry: 3000\n\n");
      send("progress", first);

      let last = JSON.stringify(first);
      let current: ProgressEvent | null = first;
      const startedAt = Date.now();
      let lastWrite = startedAt;

      try {
        while (current && !isTerminal(current) && !signal.aborted && Date.now() - startedAt < MAX_STREAM_MS) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          current = await tripRepo.getProgress(id);
          if (!current) {
            send("error", { code: "NOT_FOUND", message: "여행이 삭제되었습니다." });
            break;
          }
          const serialized = JSON.stringify(current);
          if (serialized !== last) {
            send("progress", current);
            last = serialized;
            lastWrite = Date.now();
          } else if (Date.now() - lastWrite >= HEARTBEAT_MS) {
            write(": ping\n\n"); // 프록시·로드밸런서의 유휴 연결 종료 방지
            lastWrite = Date.now();
          }
        }
      } catch (error) {
        console.error(`[sse] trip ${id}`, error);
        send("error", { code: "INTERNAL_ERROR", message: "진행 상황을 읽지 못했습니다." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
