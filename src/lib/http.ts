/** 모든 외부 호출의 기본 정책: 15초 타임아웃 + 1회 재시도 */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** 예외: LLM 호출(Gemini 생성·검색 그라운딩)은 추론 시간이 길어 60초 */
export const LLM_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRIES = 1;
const RETRY_DELAY_MS = 500;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${redactUrl(url)}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

/**
 * 일·월 단위 할당량을 다 쓴 429인지 (예: Gemini 무료 등급 "requests per day"). 잠깐의 속도 제한과 달리
 * 몇 시간 뒤에야 풀리므로 재시도하지 않고, 같은 작업의 다른 AI 호출도 건너뛰어 대체 경로로 간다.
 */
export function isQuotaExhausted(error: unknown): boolean {
  const status = error instanceof HttpError ? error.status : (error as { status?: unknown })?.status;
  if (status !== 429) return false;
  const text = error instanceof HttpError ? error.body : String((error as { message?: unknown })?.message ?? "");
  return /PerDay|per day|PerMonth|per month|check your plan and billing/i.test(text);
}

/** withTimeoutRetry의 시간 초과 (SDK가 signal을 무시해도 이 오류로 끝난다) */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`timeout after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export interface RetryOptions {
  timeoutMs?: number;
  retries?: number;
  /** false를 반환하면 재시도하지 않는다. 기본: 네트워크 오류·타임아웃·408/429/5xx만 재시도 */
  shouldRetry?: (error: unknown) => boolean;
}

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * 다시 보내면 성공할 수 있는 오류인지. 응답 형식 오류(JSON 파싱·스키마 검증)나 4xx처럼
 * 같은 요청을 반복해도 결과가 같은 오류는 재시도하지 않는다 (비용·지연만 늘어남).
 */
export function isRetryable(error: unknown): boolean {
  if (isQuotaExhausted(error)) return false;
  if (error instanceof HttpError) return retryableStatus(error.status);
  // SDK 오류(Gemini)는 status 필드를 노출한다.
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return retryableStatus(status);
  if (error instanceof TimeoutError) return true;
  // fetch의 네트워크 실패는 TypeError("fetch failed"), 중단·시간 초과는 AbortError/TimeoutError(DOMException)
  if (error instanceof TypeError) return true;
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * fn에 AbortSignal을 넘겨 timeoutMs 안에 끝나지 않으면 중단하고, 실패 시 retries만큼 재시도한다.
 */
export async function withTimeoutRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, shouldRetry = isRetryable }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await raceAbort(fn(signal), signal, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastError;
}

/** signal을 무시하는 SDK가 있어도 타임아웃이 확실히 적용되도록 Promise 경쟁을 건다. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError(timeoutMs));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** fetch + 타임아웃·재시도 + 비 2xx 시 HttpError + JSON 파싱 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<T> {
  return withTimeoutRetry(async (signal) => {
    const res = await fetch(url, { ...init, signal });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    return (text ? JSON.parse(text) : null) as T;
  }, options);
}

/** 로그·오류 메시지에 API 키가 새지 않도록 쿼리스트링의 key 류 파라미터를 가린다. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|apikey|api_key|client_secret)=)[^&]+/gi, "$1***");
}
