/**
 * 비용 추정용 단가 (USD). 확인일 2026-10-27.
 *  - Gemini 3.8 Flash: https://ai.google.dev/gemini-api/docs/pricing (2026-12-31까지 프로모션, 2027-01-01부터 2배)
 *  - Google Maps Platform: https://developers.google.com/maps/billing-and-pricing/pricing (0~100k 구간 정가, 월 무료 한도 미반영)
 * 가정·미확인:
 *  - Places Text Search는 rating·regularOpeningHours 필드를 요청하므로 Enterprise SKU로 본다.
 *  - Route Matrix는 요소(출발×도착) 단위, Essentials 단가로 본다 (TRANSIT이 Pro로 과금되는지 미확인).
 *  - Naver Cloud Maps 단가는 확인하지 못해 0으로 둔다 (NCP 무료 이용량 내 가정).
 */
import type { MapsSku, UsageSummary } from "./types";

export const GEMINI_PRICE = {
  promo: { inputPerM: 0.75, outputPerM: 3.75 },
  from2027: { inputPerM: 1.5, outputPerM: 7.5 },
};
/** Google 검색 그라운딩: 월 5,000회 무료(Gemini 3 계열 공유), 초과 시 1,000회당 $14 */
export const SEARCH_PRICE_PER_1000 = 14;
export const SEARCH_FREE_PER_MONTH = 5_000;

export const MAPS_PRICE_PER_1000: Record<MapsSku, number> = {
  "google.geocode": 5,
  "google.placesTextSearch": 35,
  "google.routeMatrixElement": 5,
  "google.computeRoutes": 5,
  "naver.geocode": 0,
  "naver.directions5": 0,
  "naver.directions15": 0,
  "naver.localSearch": 0,
};

export const USD_TO_KRW = 1_400; // 가정 환율

export interface CostEstimate {
  geminiUsd: number;
  gemini2027Usd: number;
  /** 무료 한도 초과 시 검색 비용 (한도 내면 실제 0) */
  searchUsdIfPaid: number;
  mapsUsd: number;
  totalUsd: number;
  totalKrw: number;
}

export function estimateCost(usage: UsageSummary): CostEstimate {
  // 사고 토큰은 출력 단가로 과금된다
  const out = usage.tokens.output + usage.tokens.thought;
  const gemini = (p: { inputPerM: number; outputPerM: number }) => (usage.tokens.input * p.inputPerM + out * p.outputPerM) / 1e6;
  const mapsUsd = Object.entries(usage.skus).reduce((s, [sku, units]) => s + ((units ?? 0) * MAPS_PRICE_PER_1000[sku as MapsSku]) / 1000, 0);
  const geminiUsd = gemini(GEMINI_PRICE.promo);
  const totalUsd = geminiUsd + mapsUsd;
  return {
    geminiUsd,
    gemini2027Usd: gemini(GEMINI_PRICE.from2027),
    searchUsdIfPaid: (usage.searchQueries * SEARCH_PRICE_PER_1000) / 1000,
    mapsUsd,
    totalUsd,
    totalKrw: Math.round(totalUsd * USD_TO_KRW),
  };
}
