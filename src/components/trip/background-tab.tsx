import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CityDetail } from "@/lib/schemas";
import { SourceLink } from "./common";

const SECTIONS = [
  { key: "history", title: "역사" },
  { key: "culture", title: "문화" },
  { key: "bestTime", title: "기후·최적 시기" },
  { key: "etiquette", title: "기본 매너" },
] as const;

/** 배경지식: 위키백과·위키여행 원문 기반 요약. 각 문단 끝에 출처 링크 */
export function BackgroundTab({ city }: { city: CityDetail }) {
  const bg = city.background;
  if (!bg) return <p className="py-8 text-center text-sm text-muted-foreground">배경지식을 수집하지 못했습니다.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {SECTIONS.map(({ key, title }) => (
        <Card key={key} size="sm">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            {bg[key] ? (
              <p className="text-sm leading-relaxed">
                {bg[key]}{" "}
                {bg.sources.map((s) => (
                  <SourceLink key={s.url} href={s.url} className="mr-1.5 align-baseline">
                    {s.title}
                  </SourceLink>
                ))}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">출처 원문에 이 내용이 없어 비워 두었습니다.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
