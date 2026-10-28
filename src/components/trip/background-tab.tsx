import { SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { CityDetail } from "@/lib/schemas";
import { SourceLink } from "./common";

const SECTIONS = [
  { key: "history", title: "역사" },
  { key: "culture", title: "문화" },
  { key: "bestTime", title: "기후·최적 시기" },
  { key: "etiquette", title: "기본 매너" },
] as const;

/**
 * 배경지식: 위키백과·위키여행 원문 기반 요약. 원문에 없어 AI(Gemini) 일반 지식으로 채운 항목은
 * "AI 요약 정보"로 표시하고 출처 링크 대신 일반 참고 정보라는 안내를 붙인다.
 */
export function BackgroundTab({ city }: { city: CityDetail }) {
  const bg = city.background;
  if (!bg) return <p className="py-8 text-center text-sm text-muted-foreground">배경지식을 수집하지 못했습니다.</p>;
  const aiFields = new Set(bg.aiFields);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {SECTIONS.map(({ key, title }) => {
        const text = bg[key];
        const isAi = aiFields.has(key);
        return (
          <Card key={key} size="sm" data-testid={`background-${key}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {title}
                {text && isAi && (
                  <Badge variant="secondary" className="font-normal">
                    <SparklesIcon data-icon="inline-start" aria-hidden />
                    AI 요약 정보
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {text ? (
                <p className="text-sm leading-relaxed">
                  {text}{" "}
                  {!isAi &&
                    bg.sources.map((s) => (
                      <SourceLink key={s.url} href={s.url} className="mr-1.5 align-baseline">
                        {s.title}
                      </SourceLink>
                    ))}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">이 도시에 대해 확인된 내용이 없어 비워 두었습니다.</p>
              )}
            </CardContent>
            {text && isAi && (
              <CardFooter>
                <p className="text-xs text-muted-foreground">출처 원문이 아닌 AI 일반 지식 기반 참고 정보입니다. 중요한 내용은 공식 정보로 확인하세요.</p>
              </CardFooter>
            )}
          </Card>
        );
      })}
    </div>
  );
}
