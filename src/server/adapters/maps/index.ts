import { getEnv } from "@/lib/env";
import { GoogleMapsProvider } from "./google";
import { NaverMapsProvider } from "./naver";
import type { MapsProvider } from "./types";

export * from "./types";
export { GoogleMapsProvider } from "./google";
export { NaverMapsProvider } from "./naver";

let google: GoogleMapsProvider | undefined;
let naver: NaverMapsProvider | undefined;

/** 국가코드로 지도 공급자를 고른다: KR → Naver, 그 외 → Google */
export function getMapsProvider(countryCode: string): MapsProvider {
  if (countryCode.trim().toUpperCase() === "KR") {
    const env = getEnv();
    naver ??= new NaverMapsProvider({
      mapsClientId: env.NAVER_MAPS_CLIENT_ID,
      mapsClientSecret: env.NAVER_MAPS_CLIENT_SECRET,
      searchClientId: env.NAVER_SEARCH_CLIENT_ID,
      searchClientSecret: env.NAVER_SEARCH_CLIENT_SECRET,
    });
    return naver;
  }
  google ??= new GoogleMapsProvider({ serverKey: getEnv().GOOGLE_MAPS_SERVER_KEY });
  return google;
}
