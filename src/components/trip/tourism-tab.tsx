"use client";

import { BadgeCheckIcon, ClockIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { summarizeHours } from "@/lib/hours";
import { POI_CATEGORY_LABEL } from "@/lib/labels";
import type { CityDetail } from "@/lib/schemas";
import { hostnameOf, safeExternalUrl } from "@/lib/url";
import { SourceLink } from "./common";

const FILTERS = ["all", "sight", "museum", "food"] as const;
type Filter = (typeof FILTERS)[number];

/** 요일별 운영시간을 "화–일 09:00–18:00"처럼 묶어 보여준다. 해석할 수 없으면 원문 */
function OpeningHours({ hours }: { hours: string[] | null }) {
  if (!hours?.length) {
    return (
      <p className="flex items-start gap-1">
        <ClockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
        운영시간 정보 없음 (출처에 없음)
      </p>
    );
  }
  const summary = summarizeHours(hours);
  return (
    <div className="flex items-start gap-1" data-testid="opening-hours">
      <ClockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
      {summary ? (
        <ul className="space-y-0.5">
          {summary.map((line) => (
            <li key={line} className={line.includes("휴무") ? "text-amber-700 dark:text-amber-400" : undefined}>
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <details>
          <summary className="cursor-pointer select-none">요일별 운영시간</summary>
          <ul className="mt-1 space-y-0.5">
            {hours.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 관광청·명소: 관광청 링크 카드 + 명소 목록(카테고리 필터) */
export function TourismTab({ city }: { city: CityDetail }) {
  const [filter, setFilter] = useState<Filter>("all");
  const pois = useMemo(() => (filter === "all" ? city.pois : city.pois.filter((p) => p.category === filter)), [city.pois, filter]);
  const t = city.tourismBoard;

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="tourism-heading">
        <h2 id="tourism-heading" className="text-base font-semibold">
          관광청 정보
        </h2>
        {t ? (
          <>
            <p className="text-sm leading-relaxed">{t.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {t.sources.filter((s) => safeExternalUrl(s.url)).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="group">
                  <Card size="sm" className="h-full transition-colors group-hover:bg-muted/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        {s.official && <BadgeCheckIcon className="size-4 shrink-0 text-primary" aria-label="공식" />}
                        <span className="truncate">{hostnameOf(s.url) ?? s.url}</span>
                      </CardTitle>
                      <CardDescription className="truncate">{s.official ? "공식·정부 출처" : s.title}</CardDescription>
                    </CardHeader>
                  </Card>
                </a>
              ))}
            </div>
            {(t.festivals.length > 0 || t.transitPasses.length > 0) && (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {t.festivals.length > 0 && (
                  <div>
                    <dt className="font-medium">축제</dt>
                    <dd className="text-muted-foreground">{t.festivals.join(" · ")}</dd>
                  </div>
                )}
                {t.transitPasses.length > 0 && (
                  <div>
                    <dt className="font-medium">교통패스</dt>
                    <dd className="text-muted-foreground">{t.transitPasses.join(" · ")}</dd>
                  </div>
                )}
              </dl>
            )}
            {t.searchEntryPointHtml && (
              // Google 검색 그라운딩 결과에는 검색 추천을 함께 표시해야 한다 (Gemini API 약관). 스타일·스크립트 격리를 위해 iframe 사용
              <iframe
                title="Google 검색 추천"
                srcDoc={t.searchEntryPointHtml}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="h-24 w-full rounded-md border"
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">관광청 정보를 수집하지 못했습니다.</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="poi-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="poi-heading" className="text-base font-semibold">
            명소 <span className="text-sm font-normal text-muted-foreground">{pois.length}곳</span>
          </h2>
          <ToggleGroup variant="outline" size="sm" value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as Filter)} aria-label="카테고리 필터">
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f} value={f}>
                {f === "all" ? "전체" : POI_CATEGORY_LABEL[f]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="poi-list">
          {pois.map((p) => (
            <li key={p.id}>
              <Card size="sm" className="h-full">
                <CardHeader>
                  <CardTitle className="text-sm">{p.name}</CardTitle>
                  <CardDescription>
                    <Badge variant="secondary">{POI_CATEGORY_LABEL[p.category] ?? p.category}</Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs text-muted-foreground">
                  <OpeningHours hours={p.hours} />
                  {p.sourceUrl && <SourceLink href={p.sourceUrl}>출처</SourceLink>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
