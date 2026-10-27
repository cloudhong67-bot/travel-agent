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

export interface RetryOptions {
  timeoutMs?: number;
  retries?: number;
  /** false를 반환하면 재시도하지 않는다. 기본: 네트워크 오류·타임아웃·408/429/5xx만 재시도 */
  shouldRetry?: (error: unknown) => boolean;
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // SDK 오류(Gemini·OpenAI)는 status 필드를 노출한다.
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500;
  }
  // AbortError/TimeoutError/TypeError(fetch failed) 등 네트워크 계열
  return true;
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
    const onAbort = () => reject(new Error(`timeout after ${timeoutMs}ms`));
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
