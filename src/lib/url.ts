/**
 * URL 유틸 (서버·클라이언트 공용 순수 함수).
 * 외부 데이터(검색 결과·지도 장소·LLM 답변)에서 온 URL을 다룰 때 여기 함수만 쓴다.
 */

/** "www."를 뗀 소문자 호스트명. URL이 아니면 null */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * 링크로 써도 되는 URL만 돌려준다 (http/https). javascript:·data: 같은 스킴은 null.
 * React 19의 javascript: 차단에만 기대지 않는다.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
