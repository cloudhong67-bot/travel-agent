/** 화면 표시용 한국어 라벨·색상 (서버·클라이언트 공용) */
import type { AgentStep, Budget, TripStatus } from "./schemas";

export const TRAVEL_STYLES = ["역사", "미식", "자연", "쇼핑"] as const;

export const TRANSPORT_LABEL: Record<string, string> = {
  transit: "대중교통",
  driving: "자동차",
  walking: "도보",
  mixed: "혼합",
};

export const BUDGET_LABEL: Record<Budget, string> = { low: "알뜰", medium: "보통", high: "여유" };

export const STATUS_LABEL: Record<TripStatus, string> = {
  queued: "대기 중",
  running: "생성 중",
  done: "완료",
  failed: "실패",
};

/** 진행 화면에 보여줄 파이프라인 단계 (PRD 7장 순서) */
export const PIPELINE_STEPS: { step: AgentStep; label: string }[] = [
  { step: "normalize", label: "도시 위치 확인" },
  { step: "cache", label: "저장된 정보 확인" },
  { step: "collect", label: "역사·관광청·명소·근교 조사" },
  { step: "assign", label: "일자별 배분" },
  { step: "optimize", label: "동선 최적화" },
  { step: "validate", label: "일정 검증" },
  { step: "save", label: "저장" },
];

export const POI_CATEGORY_LABEL: Record<string, string> = {
  sight: "명소",
  museum: "박물관·미술관",
  food: "맛집",
  town: "근교 도시",
};

export const TRAVEL_BASIS_LABEL: Record<string, string> = {
  transit: "대중교통 기준",
  driving: "자동차 기준",
  walking: "도보 기준",
  bicycling: "자전거 기준",
  mixed: "대중교통(일부 자동차 대체)",
  estimated: "일부 직선거리 추정",
};

/** 일자별 구분 색 (지도 마커·경로선·타임라인 공통). 밝은/어두운 배경 모두에서 대비가 나는 값 */
export const DAY_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d"];
export const dayColor = (dayIndex: number) => DAY_COLORS[dayIndex % DAY_COLORS.length];

export const COUNTRY_OPTIONS: { code: string; label: string }[] = [
  { code: "KR", label: "대한민국" },
  { code: "JP", label: "일본" },
  { code: "PT", label: "포르투갈" },
  { code: "FR", label: "프랑스" },
  { code: "IT", label: "이탈리아" },
  { code: "ES", label: "스페인" },
  { code: "TR", label: "튀르키예" },
  { code: "GB", label: "영국" },
  { code: "DE", label: "독일" },
  { code: "US", label: "미국" },
  { code: "TW", label: "대만" },
  { code: "VN", label: "베트남" },
];

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(iso));
}

export function formatMinutes(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}분`;
  return m % 60 === 0 ? `${m / 60}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** 여행 일수 → "3박 4일" (1일이면 "당일") */
export function stayLabel(days: number): string {
  return days > 1 ? `${days - 1}박 ${days}일` : "당일";
}
