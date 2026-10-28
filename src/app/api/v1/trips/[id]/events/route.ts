import { TripIdParamsSchema, type ProgressEvent } from "@/lib/schemas";
import { notFound, parseInput, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
/** 비정상적으로 오래 걸리는 작업에서 연결이 무한히 유지되지 않도록 상한을 둔다 (클라이언트는 retry로 재연결). */
const MAX_STREAM_MS = 5 * 60_000;
/** DB 조회가 연속으로 이만큼 실패하면 스트림을 끝낸다 (일시적 오류는 다음 폴링에서 다시 시도) */
const MAX_CONSECUTIVE_ERRORS = 3;

const isTerminal = (e: ProgressEvent) => e.status === "done" || e.status === "failed";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/v1/trips/{id}/events — 진행 상황 SSE.
 * 작업 상태가 DB에 있으므로 복제본이 바뀌어도 이어서 구독할 수 있다. 변경이 있을 때만 progress 이벤트를 보낸다.
 */
export const GET = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const { id } = parseInput(TripIdParamsSchema, await params);
  const first = await tripRepo.getProgress(id);
  if (!first) return notFound("여행");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /** 클라이언트가 끊은 뒤의 쓰기는 예외를 던지므로, 실패하면 닫힌 것으로 보고 멈춘다 */
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const active = () => !closed && !request.signal.aborted;

      write("retry: 3000\n\n");
      send("progress", first);

      let last = JSON.stringify(first);
      let current: ProgressEvent = first;
      let errors = 0;
      const startedAt = Date.now();
      let lastWrite = startedAt;

      while (active() && !isTerminal(current) && Date.now() - startedAt < MAX_STREAM_MS) {
        await sleep(POLL_MS);
        let next: ProgressEvent | null;
        try {
          next = await tripRepo.getProgress(id);
          errors = 0;
        } catch (error) {
          console.error(`[sse] trip ${id} 진행 조회 실패 (${errors + 1}/${MAX_CONSECUTIVE_ERRORS})`, error);
          if (++errors < MAX_CONSECUTIVE_ERRORS) continue;
          send("error", { code: "INTERNAL_ERROR", message: "진행 상황을 읽지 못했습니다." });
          break;
        }
        if (!next) {
          send("error", { code: "NOT_FOUND", message: "여행이 삭제되었습니다." });
          break;
        }
        current = next;
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

      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // 이미 취소된 스트림
        }
      }
    },
    cancel() {
      closed = true;
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
