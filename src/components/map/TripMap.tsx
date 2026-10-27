"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MapViewProps } from "./types";

const loading = () => <Skeleton className="h-full min-h-80 w-full rounded-xl" />;
// 지도 SDK는 브라우저 전용이고 무거우므로 필요할 때만 불러온다
const GoogleMap = dynamic(() => import("./GoogleMap").then((m) => m.GoogleMap), { ssr: false, loading });
const NaverMap = dynamic(() => import("./NaverMap").then((m) => m.NaverMap), { ssr: false, loading });

/** 국가코드로 지도 공급자 선택: KR → Naver Web Dynamic Map, 그 외 → Google Maps JS */
export function TripMap({ countryCode, className, ...props }: MapViewProps & { countryCode: string | null }) {
  // 지도 SDK는 height: 100%로 그리므로 컨테이너에 명시적 높이가 필요하다 (min-height만으로는 0px이 된다).
  // lg 이상에서는 sticky 헤더(5rem) 아래 화면 높이에 맞춘다
  const classes = cn("relative h-[22rem] w-full overflow-hidden rounded-xl border sm:h-[28rem] lg:h-[calc(100dvh-7rem)] lg:min-h-[28rem]", className);
  return countryCode === "KR" ? <NaverMap {...props} className={classes} /> : <GoogleMap {...props} className={classes} />;
}
