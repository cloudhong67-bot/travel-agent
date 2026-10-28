"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api-client";
import { BUDGET_LABEL, formatDate, stayLabel, TRANSPORT_LABEL } from "@/lib/labels";
import type { CityDetail, TripDetail } from "@/lib/schemas";
import { BackgroundTab } from "./background-tab";
import { Notice, ReviewBadge } from "./common";
import { ItineraryTab } from "./itinerary-tab";
import { NearbyTab } from "./nearby-tab";
import { SchedulePanel } from "./schedule-panel";
import { TourismTab } from "./tourism-tab";

/** @param onRework 일자 재생성·일정 조정을 시작했을 때 진행 화면 제목과 함께 알린다 */
export function TripResult({ trip, onRework }: { trip: TripDetail; onRework: (title: string) => void }) {
  const [city, setCity] = useState<CityDetail | null>(null);
  const cityId = trip.city?.id ?? trip.cityId;

  useEffect(() => {
    if (!cityId) return;
    api.getCity(cityId).then(setCity, (e) => toast.error("도시 정보를 불러오지 못했습니다", { description: errorMessage(e) }));
  }, [cityId]);

  const meta = trip.meta;
  const reviewCount = meta?.needsReviewDays.length ?? 0;

  return (
    <div className="space-y-6" data-testid="trip-result">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{trip.city?.name ?? trip.cityName}</h1>
          {trip.city && <Badge variant="outline">{trip.city.countryCode}</Badge>}
          {reviewCount > 0 && <ReviewBadge>검증 필요 {reviewCount}일</ReviewBadge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {stayLabel(trip.days)}{trip.autoDays ? " (추천 일수)" : ""} · {formatDate(trip.createdAt)} 생성 · {TRANSPORT_LABEL[trip.transport] ?? trip.transport}
          {trip.budget ? ` · 예산 ${BUDGET_LABEL[trip.budget]}` : ""} · {trip.style.split(",").join("·")}
        </p>
        <SchedulePanel trip={trip} onRescheduling={onRework} />
        {meta?.travelBasisNotice && <Notice tone="warn">{meta.travelBasisNotice}</Notice>}
        {meta && meta.notices.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">안내 {meta.notices.length}건</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {meta.notices.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        {meta?.partial && <Notice tone="warn">{trip.errorMessage ?? "비용 상한에 도달해 일부 결과만 저장되었습니다."}</Notice>}
        {!meta?.partial && trip.errorMessage && <Notice tone="warn">{trip.errorMessage}</Notice>}
        {meta && meta.warnings.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">생성 중 경고 {meta.warnings.length}건</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {meta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </header>

      <Tabs defaultValue="background" className="gap-4">
        {/* 모바일: 2×2 그리드(높이 자동), sm 이상: 한 줄. 기본 클래스의 고정 높이(h-8)를 모바일에서만 해제한다 */}
        <TabsList className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-fit sm:group-data-horizontal/tabs:h-8">
          {(
            [
              ["background", "배경지식"],
              ["tourism", "관광청·명소"],
              ["itinerary", "일정·동선"],
              ["nearby", "근교 소도시"],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="h-8 sm:h-[calc(100%-1px)]">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="background">{city ? <BackgroundTab city={city} /> : <TabSkeleton />}</TabsContent>
        <TabsContent value="tourism">{city ? <TourismTab city={city} /> : <TabSkeleton />}</TabsContent>
        <TabsContent value="itinerary">
          <ItineraryTab trip={trip} onRegenerating={(day) => onRework(`${day + 1}일차를 다시 만드는 중`)} />
        </TabsContent>
        <TabsContent value="nearby">
          <NearbyTab trip={trip} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
