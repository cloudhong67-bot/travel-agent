/**
 * NAVER Maps JavaScript API v3 중 이 앱이 쓰는 부분만 선언 (공식 타입 패키지 없음).
 * 참고: https://navermaps.github.io/maps.js.ncp/docs/
 */
declare namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
  }
  class LatLngBounds {
    constructor(sw?: LatLng, ne?: LatLng);
    extend(latlng: LatLng): LatLngBounds;
  }
  class Map {
    constructor(element: HTMLElement | string, options?: { center?: LatLng; zoom?: number; zoomControl?: boolean; mapDataControl?: boolean; scaleControl?: boolean });
    fitBounds(bounds: LatLngBounds, margin?: { top: number; right: number; bottom: number; left: number }): void;
    setCenter(latlng: LatLng): void;
    setZoom(zoom: number): void;
    destroy(): void;
  }
  class Marker {
    constructor(options: { position: LatLng; map?: Map; title?: string; icon?: { content: string; anchor?: Point } });
    setMap(map: Map | null): void;
  }
  class Polyline {
    constructor(options: { map?: Map; path: LatLng[]; strokeColor?: string; strokeWeight?: number; strokeOpacity?: number });
    setMap(map: Map | null): void;
  }
  class Point {
    constructor(x: number, y: number);
  }
}

interface Window {
  naver?: { maps: typeof naver.maps };
}
