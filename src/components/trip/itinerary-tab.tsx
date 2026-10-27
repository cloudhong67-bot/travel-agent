"use client";

import { ArrowDownIcon, ClockIcon, HomeIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TripMap } from "@/components/map/TripMap";
import type { MapMarker, MapPolyline } from "@/components/map/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { hoursOn, weekdayFromKo } from "@/lib/hours";
import { dayColor, formatMinutes, POI_CATEGORY_LABEL, TRAVEL_BASIS_LABEL } from "@/lib/labels";
import type { TripDayView, TripDetail } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { ReviewBadge, SourceLink } from "./common";

const BASE_COLOR = "#475569";

/** 지도용 마커·경로선 (일자별 색 구분). 경로선이 없으면 방문 순서대로 직선 연결 */
export function buildMapLayers(itinerary: TripDayView[]): { markers: MapMarker[]; polylines: MapPolyline[] } {
  const markers: MapMarker[] = [];
  const polylines: MapPolyline[] = [];
  const base = itinerary[0]?.stops.base;
  if (base) markers.push({ id: "base", position: { lat: base.lat, lng: base.lon }, label: "H", title: base.name, color: BASE_COLOR, day: null });

  for (const day of itinerary) {
    const plan = day.stops;
    const color = dayColor(day.dayIndex);
    plan.stops.forEach((s) =>
      markers.push({ id: `${day.dayIndex}-${s.key}`, position: { lat: s.lat, lng: s.lon }, label: String(s.order), title: `${day.dayIndex + 1}일차 ${s.order}. ${s.name}`, color, day: day.dayIndex }),
    );
    const path = day.routeGeo
      ? day.routeGeo.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : [plan.base, ...plan.stops, plan.base].map((p) => ({ lat: p.lat, lng: p.lon }));
    if (plan.stops.length > 0) polylines.push({ id: `route-${day.dayIndex}`, path, color, day: day.dayIndex });
  }
  return { markers, polylines };
}

export function ItineraryTab({ trip, onRegenerating }: { trip: TripDetail; onRegenerating: (dayIndex: number) => void }) {
  const [selectedDay, setSelectedDay] = useState<number | null>(trip.itinerary[0]?.dayIndex ?? null);
  const layers = useMemo(() => buildMapLayers(trip.itinerary), [trip.itinerary]);
  const days = selectedDay === null ? trip.itinerary : trip.itinerary.filter((d) => d.dayIndex === selectedDay);

  if (trip.itinerary.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">저장된 일정이 없습니다.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="일자 선택">
        <DayButton active={selectedDay === null} onClick={() => setSelectedDay(null)}>
          전체
        </DayButton>
        {trip.itinerary.map((d) => (
          <DayButton key={d.dayIndex} active={selectedDay === d.dayIndex} onClick={() => setSelectedDay(d.dayIndex)} color={dayColor(d.dayIndex)} review={d.stops.needsReview}>
            {d.dayIndex + 1}일차
          </DayButton>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-6" data-testid="timeline">
          {days.map((d) => (
            <DayTimeline key={d.dayIndex} tripId={trip.id} day={d} onRegenerating={onRegenerating} />
          ))}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <TripMap countryCode={trip.meta?.countryCode ?? trip.city?.countryCode ?? null} markers={layers.markers} polylines={layers.polylines} selectedDay={selectedDay} />
        </div>
      </div>
    </div>
  );
}

function DayButton({ active, onClick, color, review, children }: { active: boolean; onClick: () => void; color?: string; review?: boolean; children: React.ReactNode }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick} aria-pressed={active}>
      {color && <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
      {review && <span className="size-2 rounded-full bg-amber-400" aria-label="검증 필요" />}
    </Button>
  );
}

function DayTimeline({ tripId, day, onRegenerating }: { tripId: string; day: TripDayView; onRegenerating: (dayIndex: number) => void }) {
  const plan = day.stops;
  const [busy, setBusy] = useState(false);
  const issuesByKey = new Map<string, string[]>();
  for (const i of plan.validation.issues) if (i.poiKey) issuesByKey.set(i.poiKey, [...(issuesByKey.get(i.poiKey) ?? []), i.message]);
  const dayIssues = plan.validation.issues.filter((i) => !i.poiKey);

  async function regenerate() {
    setBusy(true);
    try {
      await api.regenerateDay(tripId, day.dayIndex);
      toast.success(`${day.dayIndex + 1}일차를 다시 만드는 중입니다`);
      onRegenerating(day.dayIndex);
    } catch (e) {
      toast.error("다시 만들지 못했습니다", { description: errorMessage(e) });
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-4" aria-labelledby={`day-${day.dayIndex}`} data-testid={`day-${day.dayIndex}`}>
      <header className="mb-4 flex flex-wrap items-start gap-2">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: dayColor(day.dayIndex) }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id={`day-${day.dayIndex}`} className="font-semibold">
            {day.dayIndex + 1}일차 · {day.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {plan.date ? `${plan.date} (${plan.weekday})` : "날짜 미정"} · {TRAVEL_BASIS_LABEL[plan.travelBasis] ?? plan.travelBasis} · 이동 {formatMinutes(plan.totals.travelMins)} / 체류{" "}
            {formatMinutes(plan.totals.stayMins)}
          </p>
        </div>
        {plan.needsReview && <ReviewBadge />}
        <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}이 날 다시 만들기
        </Button>
      </header>

      {dayIssues.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-amber-800 dark:text-amber-300">
          {dayIssues.map((i) => (
            <li key={i.message}>⚠ {i.message}</li>
          ))}
        </ul>
      )}

      <ol className="relative space-y-3 border-l pl-5">
        <TimelinePoint icon={<HomeIcon className="size-3" />}>
          <p className="text-sm">
            <span className="font-medium tabular-nums">09:00</span> 숙소 거점 출발
          </p>
          <p className="text-xs text-muted-foreground">{plan.base.name}</p>
        </TimelinePoint>
        {plan.stops.map((s) => (
          <TimelinePoint key={s.key} label={String(s.order)} color={dayColor(day.dayIndex)}>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowDownIcon className="size-3" aria-hidden />
              이동 {formatMinutes(s.travelMinsFromPrev)}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium tabular-nums">
                {s.arrive}–{s.depart}
              </span>
              <span className="text-sm font-medium">{s.name}</span>
              <Badge variant="secondary">{POI_CATEGORY_LABEL[s.category] ?? s.category}</Badge>
              {issuesByKey.has(s.key) && <ReviewBadge>{issuesByKey.get(s.key)!.join(", ")}</ReviewBadge>}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3" aria-hidden />
                체류 {formatMinutes(s.stayMins)}
              </span>
              <DayHours hours={s.openingHours} weekday={plan.weekday} />
              {s.sourceUrl ? <SourceLink href={s.sourceUrl}>출처</SourceLink> : <span>출처 없음</span>}
            </p>
          </TimelinePoint>
        ))}
        {plan.stops.length > 0 && (
          <TimelinePoint icon={<HomeIcon className="size-3" />}>
            <p className="text-xs text-muted-foreground">이동 {formatMinutes(plan.returnTravelMins)} 후 숙소 거점 복귀</p>
          </TimelinePoint>
        )}
      </ol>
    </section>
  );
}

/** 그날 요일의 운영시간 (출발일이 없거나 정보가 없으면 표시하지 않음) */
function DayHours({ hours, weekday }: { hours: string[] | null; weekday: string | null }) {
  const day = weekdayFromKo(weekday);
  if (day < 0) return null;
  const text = hoursOn(hours, day);
  if (!text) return hours?.length ? null : <span>운영시간 정보 없음</span>;
  return <span className={text === "휴무" ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>{text === "휴무" ? "이 날 휴무" : `운영 ${text}`}</span>;
}

function TimelinePoint({ children, label, icon, color }: { children: React.ReactNode; label?: string; icon?: React.ReactNode; color?: string }) {
  return (
    <li className="relative">
      <span
        className={cn("absolute top-0.5 -left-[1.95rem] flex size-5 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white", !color && "bg-muted-foreground")}
        style={color ? { background: color } : undefined}
        aria-hidden
      >
        {label ?? icon}
      </span>
      <div className="space-y-0.5">{children}</div>
    </li>
  );
}
