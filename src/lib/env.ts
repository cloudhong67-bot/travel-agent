import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

/**
 * 서버·브라우저에서 사용하는 모든 환경변수 스키마.
 * 비밀값은 절대 코드에 하드코딩하지 않고 이 스키마를 통해서만 읽는다.
 */
export const envSchema = z.object({
  /** LLM과 Google 검색 그라운딩 공용 키 */
  GEMINI_API_KEY: nonEmpty,
  GEMINI_MODEL: nonEmpty.default("gemini-3.8-flash"),

  GOOGLE_MAPS_SERVER_KEY: nonEmpty,
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: nonEmpty,

  NAVER_MAPS_CLIENT_ID: nonEmpty,
  NAVER_MAPS_CLIENT_SECRET: nonEmpty,
  NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID: nonEmpty,

  NAVER_SEARCH_CLIENT_ID: nonEmpty,
  NAVER_SEARCH_CLIENT_SECRET: nonEmpty,

  DATABASE_URL: nonEmpty,
  APP_ACCESS_TOKEN: z.string().min(16, "APP_ACCESS_TOKEN은 16자 이상이어야 합니다"),
  DAILY_TRIP_LIMIT: z.coerce.number().int().positive().default(10),

  /** Application Insights. 없으면 원격 측정을 끈다 (로컬 개발 기본) */
  APPLICATIONINSIGHTS_CONNECTION_STRING: nonEmpty.optional(),
});

export type Env = z.infer<typeof envSchema>;

type EnvSource = Record<string, string | undefined>;

/** 빈 문자열(.env의 `KEY=`)은 미설정으로 취급한다. */
function normalize(source: EnvSource): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = source[key];
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

let cached: Env | undefined;

/** 검증 실패를 키 이름 목록으로 바꾼다 (값은 넣지 않는다 — 비밀값이 로그에 남지 않게) */
function envError(title: string, error: z.ZodError): Error {
  const issues = error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  return new Error(`${title}:\n${issues}`);
}

/** 전체 환경변수를 엄격하게 검증한다. 누락·형식 오류가 있으면 키 이름을 나열해 throw. */
export function getEnv(source: EnvSource = process.env): Env {
  if (cached && source === process.env) return cached;
  const result = envSchema.safeParse(normalize(source));
  if (!result.success) throw envError("환경변수 검증 실패", result.error);
  if (source === process.env) cached = result.data;
  return result.data;
}

/**
 * 필요한 키만 검증해 읽는다. 프록시·DB 클라이언트처럼 일부 값만 필요한 곳에서
 * 무관한 변수 누락 때문에 전체가 실패하지 않게 한다.
 */
export function pickEnv<K extends keyof Env>(keys: readonly K[], source: EnvSource = process.env): Pick<Env, K> {
  const subset = z.object(Object.fromEntries(keys.map((k) => [k, envSchema.shape[k]])));
  const result = subset.safeParse(normalize(source));
  if (!result.success) throw envError("환경변수 검증 실패", result.error);
  return result.data as unknown as Pick<Env, K>;
}

export type PartialEnv = Partial<Env>;

/**
 * 스크립트(PoC 등)용: 설정된 값만 검증해 돌려준다.
 * 형식이 잘못된 값은 throw, 누락된 값은 undefined로 둔다.
 */
export function getPartialEnv(source: EnvSource = process.env): PartialEnv {
  const result = envSchema.partial().safeParse(normalize(source));
  if (!result.success) throw envError("환경변수 형식 오류", result.error);
  return result.data;
}
