"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { CreateTripRequestSchema, type TripDetail } from "@/lib/schemas";
import { TripProgress } from "./trip-progress";
import { TripResult } from "./trip-result";

/** /trips/[id]: 상태에 따라 진행 화면 → 결과 화면, 실패 시 오류·재시도 */
export function TripScreen({ id }: { id: string }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 일자 재생성·일정 조정 중이면 진행 화면 제목 */
  const [reworkTitle, setReworkTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getTrip(id).then(
      (t) => {
        if (cancelled) return;
        setTrip(t);
        setLoadError(null);
      },
      (e) => {
        if (cancelled) return;
        setLoadError(errorMessage(e));
        toast.error("여행을 불러오지 못했습니다", { description: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  const onFinished = useCallback(() => {
    setReworkTitle(null);
    load();
  }, [load]);

  if (loadError && !trip) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>여행을 불러오지 못했습니다</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button onClick={load}>다시 시도</Button>
          <Button variant="outline" render={<Link href="/trips" />}>
            목록으로
          </Button>
        </CardFooter>
      </Card>
    );
  }
  if (!trip) return <TripSkeleton />;

  if (trip.status === "queued" || trip.status === "running") {
    const title = reworkTitle ?? `${trip.cityName} 일정을 만드는 중`;
    return <TripProgress key={`${trip.id}-${reworkTitle}`} trip={trip} title={title} onFinished={onFinished} />;
  }
  if (trip.status === "failed") return <TripFailed trip={trip} />;

  return (
    <TripResult
      trip={trip}
      onRework={(title) => {
        setReworkTitle(title);
        setTrip({ ...trip, status: "running", step: "assign", stepMessage: `${title} (대기)`, progress: 0 });
      }}
    />
  );
}

function TripFailed({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  /** 재시도 전용 API가 없으므로 같은 조건으로 새 여행을 만든다 (하루 생성 한도에 포함) */
  async function retry() {
    setBusy(true);
    try {
      const body = CreateTripRequestSchema.parse({
        city: trip.cityName,
        countryCode: trip.countryCode ?? undefined,
        days: trip.days,
        startDate: trip.startDate?.slice(0, 10),
        style: trip.style,
        transport: trip.transport,
        budget: trip.budget ?? undefined,
      });
      const { tripId } = await api.createTrip(body);
      router.push(`/trips/${tripId}`);
    } catch (e) {
      toast.error("다시 시도하지 못했습니다", { description: errorMessage(e) });
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-xl" data-testid="trip-failed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <TriangleAlertIcon className="size-5 text-destructive" aria-hidden />
          {trip.cityName} 일정을 만들지 못했습니다
        </CardTitle>
        <CardDescription>{trip.errorMessage ?? "알 수 없는 오류가 발생했습니다."}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">다시 시도하면 같은 조건으로 새 여행을 만듭니다 (하루 생성 한도에 1건 포함).</CardContent>
      <CardFooter className="gap-2">
        <Button onClick={retry} disabled={busy}>
          <RotateCcwIcon />
          재시도
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          새 여행
        </Button>
      </CardFooter>
    </Card>
  );
}

export function TripSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="불러오는 중">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
