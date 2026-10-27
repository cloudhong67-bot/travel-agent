export interface LatLng {
  lat: number;
  lng: number;
}

export type MapsProviderName = "google" | "naver";
export type TravelMode = "driving" | "walking" | "transit" | "bicycling";

export interface GeocodeResult {
  name: string;
  formattedAddress: string;
  location: LatLng;
  /** ISO 3166-1 alpha-2 (확인 불가 시 undefined) */
  countryCode?: string;
  placeId?: string;
  provider: MapsProviderName;
}

export interface Place {
  id: string;
  name: string;
  address?: string;
  location: LatLng;
  categories: string[];
  rating?: number;
  /** 사람이 읽는 요일별 운영시간 (공급자 원문) */
  openingHours?: string[];
  url?: string;
  provider: MapsProviderName;
}

export interface SearchPlacesOptions {
  near?: LatLng;
  radiusM?: number;
  limit?: number;
  /** BCP-47, 예: "ko" */
  language?: string;
}

export interface MatrixCell {
  durationSec: number;
  distanceM: number;
}

export type Unsupported = { supported: false; provider: MapsProviderName; reason: string };

export type TravelTimeMatrix =
  | {
      supported: true;
      provider: MapsProviderName;
      mode: TravelMode;
      /** [originIndex][destinationIndex], 경로 없음·호출 실패는 null */
      cells: (MatrixCell | null)[][];
    }
  | Unsupported;

export interface GeoJsonLineString {
  type: "LineString";
  /** [lng, lat] 순서 (GeoJSON 규격) */
  coordinates: [number, number][];
}

export type RouteGeometry =
  | {
      supported: true;
      provider: MapsProviderName;
      mode: TravelMode;
      durationSec: number;
      distanceM: number;
      geometry: GeoJsonLineString;
    }
  | Unsupported;

export interface MapsProvider {
  readonly name: MapsProviderName;
  geocode(query: string, options?: { language?: string }): Promise<GeocodeResult[]>;
  searchPlaces(query: string, options?: SearchPlacesOptions): Promise<Place[]>;
  travelTimeMatrix(origins: LatLng[], destinations: LatLng[], mode: TravelMode): Promise<TravelTimeMatrix>;
  /** points 순서대로 지나는 경로선 (첫 점 출발, 마지막 점 도착, 사이는 경유지) */
  routeGeometry(points: LatLng[], mode: TravelMode): Promise<RouteGeometry>;
}
