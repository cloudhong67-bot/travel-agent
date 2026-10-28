"use client";

import { AdvancedMarker, APIProvider, ColorScheme, Map, Pin, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { MapUnavailable } from "./MapUnavailable";
import { visible, type MapViewProps } from "./types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
// Advanced Marker에는 Map ID가 필요하다. 운영에서는 Cloud 콘솔에서 만든 Map ID로 바꾼다.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

/** 표시 중인 마커가 모두 보이도록 화면을 맞춘다 */
function FitBounds({ points }: { points: google.maps.LatLngLiteral[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
  }, [map, points]);
  return null;
}

export function GoogleMap({ markers, polylines, selectedDay, className }: MapViewProps) {
  const { resolvedTheme } = useTheme();
  const shownMarkers = useMemo(() => visible(markers, selectedDay), [markers, selectedDay]);
  const shownLines = useMemo(() => visible(polylines, selectedDay), [polylines, selectedDay]);
  const points = useMemo(() => shownMarkers.map((m) => m.position), [shownMarkers]);
  // 스크립트 로드 실패(네트워크·키 제한·차단 확장 프로그램) 시 빈 회색 영역 대신 안내를 보여준다 (NaverMap과 같은 처리)
  const [failed, setFailed] = useState(false);

  if (!API_KEY) return <MapUnavailable className={className} reason="NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY가 설정되지 않았습니다." />;
  if (failed) return <MapUnavailable className={className} reason="Google 지도 스크립트를 불러오지 못했습니다." />;

  return (
    <div className={className} data-testid="google-map">
      <APIProvider apiKey={API_KEY} language="ko" region="KR" onError={() => setFailed(true)}>
        <Map
          mapId={MAP_ID}
          defaultCenter={points[0] ?? { lat: 37.5665, lng: 126.978 }}
          defaultZoom={13}
          gestureHandling="cooperative"
          colorScheme={resolvedTheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
          // 지도 저작권·Google 로고는 기본 위치(하단)에 그대로 둔다
          style={{ width: "100%", height: "100%" }}
        >
          {shownLines.map((l) => (
            <Polyline key={l.id} path={l.path} strokeColor={l.color} strokeOpacity={0.85} strokeWeight={4} />
          ))}
          {shownMarkers.map((m) => (
            <AdvancedMarker key={m.id} position={m.position} title={m.title}>
              <Pin background={m.color} borderColor="#ffffff" glyphColor="#ffffff" glyphText={m.label} />
            </AdvancedMarker>
          ))}
          <FitBounds points={points} />
        </Map>
      </APIProvider>
    </div>
  );
}
