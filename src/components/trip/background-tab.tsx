import { SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CityDetail } from "@/lib/schemas";
import { Notice, SourceLink } from "./common";

const SECTIONS = [
  { key: "history", title: "역사" },
  { key: "culture", title: "문화" },
  { key: "bestTime", title: "기후·최적 시기" },
  { key: "etiquette", title: "기본 매너" },
] as const;

const LANG_LABEL: Record<string, string> = { en: "영어", ko: "한국어" };

/**
 * 배경지식: 위키백과·위키여행 원문 기반 한국어 요약.
 *  - AI(Gemini) 일반 지식으로 채운 항목은 카드에 "AI 요약 정보" 배지, 탭 상단에 안내 한 줄
 *  - AI 요약을 못 만들어 위키 원문 소개를 그대로 담은 경우(할당량 소진 등)도 상단에 안내
 */
export function BackgroundTab({ city }: { city: CityDetail }) {
  const bg = city.background;
  if (!bg) return <p className="py-8 text-center text-sm text-muted-foreground">배경지식을 수집하지 못했습니다. 잠시 후 여행을 다시 만들면 새로 조사합니다.</p>;
  const aiFields = new Set(bg.aiFields);

  return (
    <div className="space-y-4">
      {bg.isAiSummary && (
        <Notice>
          <span className="inline-flex items-center gap-1.5">
            <SparklesIcon className="size-3.5 shrink-0" aria-hidden />
            AI가 요약한 참고 정보입니다. &lsquo;AI 요약 정보&rsquo; 표시가 있는 항목은 출처 원문이 아닌 일반 지식을 바탕으로 했으니, 중요한 내용은 공식 정보로 확인하세요.
          </span>
        </Notice>
      )}
      {bg.isOriginalText && (
        <Notice>
          AI 요약을 만들지 못해 위키 원문 소개를 그대로 보여줍니다
          {bg.untranslatedLang ? ` (${LANG_LABEL[bg.untranslatedLang] ?? bg.untranslatedLang} 원문 — 번역하지 못했습니다)` : ""}. 잠시 후 여행을 다시 만들면 한국어 요약으로 채워집니다.
        </Notice>
      )}
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
                  <p className="text-sm leading-relaxed" lang={bg.isOriginalText && bg.untranslatedLang ? bg.untranslatedLang : undefined}>
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
