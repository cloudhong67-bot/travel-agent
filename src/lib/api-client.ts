/**
 * 브라우저용 API 클라이언트. 인증은 /unlock에서 설정한 httpOnly 쿠키가 같은 출처 요청에 자동으로 붙는다.
 * 응답은 src/lib/schemas.ts(서버와 같은 스키마)로 검증한다.
 */
import type { z } from "zod";
import {
  ApiErrorSchema,
  CityDetailSchema,
  CreateTripResponseSchema,
  RegenerateDayResponseSchema,
  TripDetailSchema,
  TripListResponseSchema,
  type CreateTripRequest,
} from "./schemas";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<S extends z.ZodType>(path: string, schema: S | null, init?: RequestInit): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }

  if (res.status === 401 && typeof window !== "undefined") {
    const next = `${window.location.pathname}${window.location.search}`;
    // 쿠키가 만료된 경우: 서버 렌더링 화면(/unlock)으로 전체 이동해야 하므로 라우터 대신 문서 이동을 쓴다
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/unlock?next=${encodeURIComponent(next)}`);
  }
  if (!res.ok) {
    const body = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiClientError(res.status, body.success ? body.data.code : "HTTP_ERROR", body.success ? body.data.message : `요청 실패 (${res.status})`);
  }
  if (!schema || res.status === 204) return undefined as z.infer<S>;

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("[api] 응답 형식 오류", path, parsed.error.issues.slice(0, 5));
    throw new ApiClientError(res.status, "INVALID_RESPONSE", "서버 응답 형식이 올바르지 않습니다.");
  }
  return parsed.data;
}

export const api = {
  createTrip: (body: CreateTripRequest) =>
    request("/api/v1/trips", CreateTripResponseSchema, { method: "POST", body: JSON.stringify(body) }),
  listTrips: (cursor?: string) =>
    request(`/api/v1/trips?limit=50${cursor ? `&cursor=${cursor}` : ""}`, TripListResponseSchema),
  getTrip: (id: string) => request(`/api/v1/trips/${id}`, TripDetailSchema),
  deleteTrip: (id: string) => request(`/api/v1/trips/${id}`, null, { method: "DELETE" }),
  getCity: (id: string) => request(`/api/v1/cities/${id}`, CityDetailSchema),
  regenerateDay: (id: string, dayIndex: number) =>
    request(`/api/v1/trips/${id}/days/${dayIndex}/regenerate`, RegenerateDayResponseSchema, { method: "POST" }),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
