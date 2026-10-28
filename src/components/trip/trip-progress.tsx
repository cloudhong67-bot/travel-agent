"use client";

import { CheckCircle2Icon, CircleIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PIPELINE_STEPS } from "@/lib/labels";
import { ApiErrorSchema, ProgressEventSchema, type AgentStep, type ProgressEvent, type TripDetail } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * 진행 화면: /api/v1/trips/{id}/events SSE를 받아 단계 목록과 진행률을 보여준다.
 * done/failed가 오면 onFinished로 상위가 상세를 다시 읽어 결과·오류 화면으로 바꾼다.
 */
export function TripProgress({ trip, title, onFinished }: { trip: TripDetail; title: string; onFinished: () => void }) {
  const [event, setEvent] = useState<Pick<ProgressEvent, "status" | "step" | "message" | "progress">>({
    status: trip.status,
    step: trip.step ?? "queued",
    message: trip.stepMessage ?? "대기 중",
    progress: trip.progress,
  });

  useEffect(() => {
    const source = new EventSource(`/api/v1/trips/${trip.id}/events`);
    source.addEventListener("progress", (e) => {
      const parsed = ProgressEventSchema.safeParse(parseJson((e as MessageEvent<string>).data));
      if (!parsed.success) return; // 형식이 어긋난 이벤트는 건너뛰고 다음 이벤트를 기다린다
      setEvent(parsed.data);
      if (parsed.data.status === "done" || parsed.data.status === "failed") {
        source.close();
        onFinished();
      }
    });
    // 서버가 보낸 event: error (예: 여행 삭제됨). 연결 오류는 EventSource가 retry 간격으로 자동 재연결한다
    source.addEventListener("error", (e) => {
      if (e instanceof MessageEvent && typeof e.data === "string") {
        source.close();
        const body = ApiErrorSchema.safeParse(parseJson(e.data));
        toast.error("진행 상황을 받을 수 없습니다", { description: body.success ? body.data.message : "잠시 후 새로고침하세요." });
      }
    });
    return () => source.close();
  }, [trip.id, onFinished]);

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.step === event.step);
  const finished = event.status === "done";
  const stateOf = (i: number): "done" | "active" | "pending" =>
    finished || (currentIndex >= 0 && i < currentIndex) ? "done" : i === currentIndex ? "active" : "pending";

  return (
    <Card className="mx-auto w-full max-w-xl" data-testid="trip-progress">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription aria-live="polite">{event.message || "준비 중"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Progress value={event.progress} aria-label="진행률" />
          <p className="text-right text-xs tabular-nums text-muted-foreground">{event.progress}%</p>
        </div>
        <ol className="space-y-3">
          {PIPELINE_STEPS.map((s, i) => (
            <StepRow key={s.step} label={s.label} state={stateOf(i)} step={s.step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function StepRow({ label, state, step }: { label: string; state: "done" | "active" | "pending"; step: AgentStep }) {
  return (
    <li className="flex items-center gap-3 text-sm" data-step={step} data-state={state}>
      {state === "done" ? (
        <CheckCircle2Icon className="size-5 text-green-600 dark:text-green-500" aria-label="완료" />
      ) : state === "active" ? (
        <Loader2Icon className="size-5 animate-spin text-primary" aria-label="진행 중" />
      ) : (
        <CircleIcon className="size-5 text-muted-foreground/50" aria-label="대기" />
      )}
      <span className={cn(state === "pending" && "text-muted-foreground", state === "active" && "font-medium")}>{label}</span>
    </li>
  );
}
