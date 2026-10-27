import { describe, expect, it } from "vitest";
import { parseJsonColumn } from "./json";

describe("parseJsonColumn", () => {
  it("JSON은 파싱, null은 null, 깨진 값은 원문", () => {
    expect(parseJsonColumn('{"a":[1]}')).toEqual({ a: [1] });
    expect(parseJsonColumn(null)).toBeNull();
    expect(parseJsonColumn("not json")).toBe("not json");
  });
});
