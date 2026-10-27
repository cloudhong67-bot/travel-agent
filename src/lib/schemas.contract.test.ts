/**
 * 에이전트가 저장하는 구조(TS 타입)와 API 응답 Zod 스키마가 어긋나지 않는지 컴파일 타임 + 런타임으로 확인한다.
 * (tsc가 테스트 파일도 검사하므로 타입이 어긋나면 typecheck에서 실패)
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CityBackground, DayPlan, NearbyTown, TourismInfo, TripMeta } from "@/server/agent/types";
import {
  CityBackgroundSchema,
  DayPlanSchema,
  NearbyTownDetailSchema,
  TourismInfoSchema,
  TripMetaSchema,
  type DayPlanView,
} from "./schemas";
import type { z } from "zod";

describe("에이전트 결과 ↔ API 스키마 계약", () => {
  it("타입이 서로 대입 가능하다", () => {
    expectTypeOf<Omit<DayPlan, "routeGeo">>().toExtend<DayPlanView>();
    expectTypeOf<NearbyTown>().toExtend<z.infer<typeof NearbyTownDetailSchema>>();
    expectTypeOf<CityBackground>().toExtend<z.infer<typeof CityBackgroundSchema>>();
    expectTypeOf<TourismInfo>().toExtend<z.infer<typeof TourismInfoSchema>>();
    expectTypeOf<TripMeta>().toExtend<z.input<typeof TripMetaSchema>>();
  });

  it("에이전트가 만든 일자 계획을 스키마가 그대로 파싱한다", () => {
    const plan: Omit<DayPlan, "routeGeo"> = {
      dayIndex: 0,
      title: "구시가지",
      date: "2027-05-03",
      weekday: "월",
      mode: "transit",
      travelBasis: "mixed",
      base: { name: "중심", lat: 41.1, lon: -8.6 },
      stops: [
        {
          order: 1, key: "P01", poiId: "x", name: "볼사 궁전", category: "sight", lat: 41.14, lon: -8.61,
          arrive: "09:10", depart: "10:10", stayMins: 60, travelMinsFromPrev: 10, sourceUrl: "https://x", openingHours: null,
        },
      ],
      returnTravelMins: 10,
      totals: { travelMins: 20, stayMins: 60, travelRatio: 0.333 },
      dayTripTown: null,
      validation: { passed: false, issues: [{ rule: "closedDay", message: "월요일 휴무", poiKey: "P01" }] },
      needsReview: true,
      attempts: 3,
    };
    expect(DayPlanSchema.parse(plan)).toEqual(plan);
  });
});
