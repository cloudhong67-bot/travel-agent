import { describe, expect, it } from "vitest";
import { getOpenApiDocument } from "./openapi";

describe("OpenAPI 문서", () => {
  const doc = getOpenApiDocument();

  it("PRD 8장의 엔드포인트를 모두 포함한다", () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual(
      [
        "/api/healthz",
        "/api/v1/cities/{id}",
        "/api/v1/trips",
        "/api/v1/trips/{id}",
        "/api/v1/trips/{id}/days/{dayIndex}/regenerate",
        "/api/v1/trips/{id}/events",
      ].sort(),
    );
  });

  it("Zod 스키마가 components로 등록되고 오류 형식이 통일돼 있다", () => {
    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(["ApiError", "CreateTripRequest", "TripDetail", "CityDetail", "ProgressEvent"]),
    );
    expect(schemas.ApiError).toMatchObject({ required: ["code", "message"] });
    const post = doc.paths?.["/api/v1/trips"]?.post;
    expect(Object.keys(post?.responses ?? {})).toEqual(expect.arrayContaining(["202", "400", "401", "429"]));
  });

  it("healthz만 인증이 없다", () => {
    expect(doc.paths?.["/api/healthz"]?.get?.security).toBeUndefined();
    expect(doc.paths?.["/api/v1/trips"]?.get?.security).toEqual([{ bearerAuth: [] }]);
  });
});
