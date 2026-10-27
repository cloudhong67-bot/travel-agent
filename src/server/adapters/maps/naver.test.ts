import { afterEach, describe, expect, it, vi } from "vitest";
import { NaverMapsProvider } from "./naver";

const provider = new NaverMapsProvider({
  mapsClientId: "id",
  mapsClientSecret: "secret",
  searchClientId: "sid",
  searchClientSecret: "ssecret",
});
const a = { lat: 35.83, lng: 129.21 };
const b = { lat: 35.79, lng: 129.33 };

afterEach(() => vi.unstubAllGlobals());

describe("NaverMapsProvider.travelTimeMatrix", () => {
  it("driving이 아니면 호출 없이 미지원을 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider.travelTimeMatrix([a], [b], "transit");
    expect(result.supported).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("쌍별로 Directions 5를 호출하고 동일 지점은 0으로 채운다", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 0, route: { traoptimal: [{ summary: { distance: 12_000, duration: 900_000 } }] } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.travelTimeMatrix([a, b], [a, b], "driving");
    expect(fetchMock).toHaveBeenCalledTimes(2); // a→b, b→a
    expect(result).toMatchObject({
      supported: true,
      cells: [
        [{ durationSec: 0, distanceM: 0 }, { durationSec: 900, distanceM: 12_000 }],
        [{ durationSec: 900, distanceM: 12_000 }, { durationSec: 0, distanceM: 0 }],
      ],
    });
  });
});
