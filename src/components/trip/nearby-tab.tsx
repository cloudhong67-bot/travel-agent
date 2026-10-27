import { TrainFrontIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes } from "@/lib/labels";
import type { TripDetail } from "@/lib/schemas";
import { Notice, SourceLink } from "./common";

/** 근교 소도시: 이동시간·추천 이유·당일치기/1박 */
export function NearbyTab({ trip }: { trip: TripDetail }) {
  const towns = trip.meta?.nearbyTowns ?? [];
  if (trip.meta?.countryCode === "KR") return <Notice>국내 도시는 근교 소도시 추천을 제공하지 않습니다.</Notice>;
  if (towns.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">편도 2시간 이내에서 추천할 근교 도시를 찾지 못했습니다.</p>;

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="nearby-list">
      {towns.map((t) => (
        <li key={t.name}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                {t.name}
                <Badge variant={t.kind === "dayTrip" ? "default" : "secondary"}>{t.kind === "dayTrip" ? "당일치기" : "1박 추천"}</Badge>
              </CardTitle>
              <CardDescription className="flex items-center gap-1">
                <TrainFrontIcon className="size-3.5" aria-hidden />
                편도 약 {formatMinutes(t.travelMins)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="leading-relaxed">{t.reason}</p>
              <SourceLink href={`https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lon}`}>지도에서 보기</SourceLink>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
