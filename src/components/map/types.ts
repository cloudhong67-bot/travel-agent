export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface MapMarker {
  id: string;
  position: LatLngLiteral;
  /** 마커에 표시할 짧은 글자 (방문 순서 등) */
  label: string;
  title: string;
  color: string;
  /** 일자 (null이면 일자와 무관: 숙소 거점·근교 도시) */
  day: number | null;
}

export interface MapPolyline {
  id: string;
  path: LatLngLiteral[];
  color: string;
  day: number | null;
}

/** GoogleMap·NaverMap 공통 props */
export interface MapViewProps {
  markers: MapMarker[];
  polylines: MapPolyline[];
  /** 선택한 일자만 표시. null이면 전체 */
  selectedDay: number | null;
  className?: string;
}

export function visible<T extends { day: number | null }>(items: T[], selectedDay: number | null): T[] {
  return selectedDay === null ? items : items.filter((i) => i.day === null || i.day === selectedDay);
}
