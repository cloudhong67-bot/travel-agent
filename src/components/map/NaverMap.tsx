"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapUnavailable } from "./MapUnavailable";
import { visible, type MapViewProps } from "./types";

const CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID;
const SCRIPT_URL = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CLIENT_ID}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Naver Web Dynamic Map. 스크립트는 next/script로 지연 로드하고, 네이버 로고·저작권 표기는 기본 위치에 둔다 */
export function NaverMap({ markers, polylines, selectedDay, className }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<naver.maps.Map | null>(null);
  const [ready, setReady] = useState(() => typeof window !== "undefined" && Boolean(window.naver?.maps));
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const initialCenter = useRef(markers[0]?.position ?? { lat: 37.5665, lng: 126.978 });

  const shownMarkers = useMemo(() => visible(markers, selectedDay), [markers, selectedDay]);
  const shownLines = useMemo(() => visible(polylines, selectedDay), [polylines, selectedDay]);

  // 지도 생성 (스크립트 로드 후 1회)
  useEffect(() => {
    if (!ready || !container.current || map.current) return;
    const c = initialCenter.current;
    map.current = new naver.maps.Map(container.current, { center: new naver.maps.LatLng(c.lat, c.lng), zoom: 13, scaleControl: true });
    setMapReady(true);
    return () => {
      map.current?.destroy();
      map.current = null;
      setMapReady(false);
    };
  }, [ready]);

  // 마커·경로선 갱신
  useEffect(() => {
    const m = map.current;
    if (!mapReady || !m) return;
    const overlays: { setMap(map: naver.maps.Map | null): void }[] = [];
    for (const l of shownLines) {
      overlays.push(new naver.maps.Polyline({ map: m, path: l.path.map((p) => new naver.maps.LatLng(p.lat, p.lng)), strokeColor: l.color, strokeWeight: 4, strokeOpacity: 0.85 }));
    }
    for (const mk of shownMarkers) {
      overlays.push(
        new naver.maps.Marker({
          map: m,
          position: new naver.maps.LatLng(mk.position.lat, mk.position.lng),
          title: mk.title,
          icon: {
            content: `<div style="background:${mk.color};color:#fff;border:2px solid #fff;border-radius:9999px;min-width:26px;height:26px;padding:0 6px;display:flex;align-items:center;justify-content:center;font:600 12px/1 sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.4)">${escapeHtml(mk.label)}</div>`,
            anchor: new naver.maps.Point(13, 13),
          },
        }),
      );
    }
    if (shownMarkers.length > 1) {
      const bounds = new naver.maps.LatLngBounds();
      shownMarkers.forEach((mk) => bounds.extend(new naver.maps.LatLng(mk.position.lat, mk.position.lng)));
      m.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    } else if (shownMarkers.length === 1) {
      m.setCenter(new naver.maps.LatLng(shownMarkers[0].position.lat, shownMarkers[0].position.lng));
      m.setZoom(14);
    }
    return () => overlays.forEach((o) => o.setMap(null));
  }, [mapReady, shownMarkers, shownLines]);

  if (!CLIENT_ID) return <MapUnavailable className={className} reason="NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID가 설정되지 않았습니다." />;
  if (failed) return <MapUnavailable className={className} reason="네이버 지도 스크립트를 불러오지 못했습니다." />;

  return (
    <div className={className} data-testid="naver-map">
      <Script src={SCRIPT_URL} strategy="lazyOnload" onReady={() => setReady(true)} onError={() => setFailed(true)} />
      <div ref={container} className="size-full" />
    </div>
  );
}
