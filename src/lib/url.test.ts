import { describe, expect, it } from "vitest";
import { hostnameOf, safeExternalUrl } from "./url";

describe("safeExternalUrl (외부 데이터 URL을 링크로 쓸 때)", () => {
  it("http(s)만 통과시키고 나머지 스킴·잘못된 값은 버린다", () => {
    expect(safeExternalUrl("https://www.visitporto.travel/pt-PT")).toBe("https://www.visitporto.travel/pt-PT");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(" JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("/relative")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("hostnameOf", () => {
  it("www를 떼고 소문자로, URL이 아니면 null", () => {
    expect(hostnameOf("https://WWW.VisitPorto.travel/pt")).toBe("visitporto.travel");
    expect(hostnameOf("not a url")).toBeNull();
  });
});
