"use client";

/**
 * 루트 레이아웃까지 실패했을 때의 최후 대체 화면 (Next.js global-error.tsx).
 * 루트 레이아웃·전역 스타일이 적용되지 않으므로 의존성 없이 인라인 스타일로 그리고, OS 색상 모드를 따른다.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <title>오류 · TripPilot</title>
        <main role="alert" style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>TripPilot을 표시하지 못했습니다</h1>
          <p style={{ opacity: 0.7, marginBottom: 16 }}>잠시 후 다시 시도하세요.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
