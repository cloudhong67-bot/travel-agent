import { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import { GeminiProvider } from "@/server/adapters/llm/gemini";
import { GoogleMapsProvider } from "@/server/adapters/maps/google";
import { NaverMapsProvider } from "@/server/adapters/maps/naver";
import { GeminiGoogleSearch } from "@/server/adapters/search/geminiGoogleSearch";
import type { AgentDeps, AgentStore } from "@/server/agent/types";

/** 실제 어댑터를 쓰되 네트워크는 MSW가 가로채는 테스트용 의존성 */
export function createTestDeps(store: AgentStore, overrides: Partial<AgentDeps> = {}): AgentDeps {
  const google = new GoogleMapsProvider({ serverKey: "test" });
  const naver = new NaverMapsProvider({ mapsClientId: "id", mapsClientSecret: "s", searchClientId: "sid", searchClientSecret: "ss" });
  return {
    store,
    llm: new GeminiProvider({ apiKey: "test", model: "gemini-3.8-flash" }),
    search: new GeminiGoogleSearch({ apiKey: "test", model: "gemini-3.8-flash" }),
    geocoder: google,
    mapsFor: (cc) => (cc === "KR" ? naver : google),
    wiki: new WikipediaKnowledge(),
    ...overrides,
  };
}
