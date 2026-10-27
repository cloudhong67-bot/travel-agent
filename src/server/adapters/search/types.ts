export interface WebSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  summary: string;
  sources: WebSource[];
  /** 모델이 실제로 실행한 검색어 (디버깅·품질 확인용) */
  searchQueries?: string[];
  /**
   * Google 검색 추천(Search Suggestions) HTML. 그라운딩 결과를 화면에 보여줄 때
   * Gemini API 약관상 함께 표시해야 하므로 저장해 둔다.
   */
  searchEntryPointHtml?: string;
}

export interface WebSearchOptions {
  /** ISO 3166-1 alpha-2. 검색 지역 힌트로 프롬프트에 포함 */
  countryCode?: string;
}

export interface WebSearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult>;
}
