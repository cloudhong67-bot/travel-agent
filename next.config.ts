import type { NextConfig } from "next";

/**
 * 모든 응답의 보안 헤더. 지도 SDK(Google·Naver)가 여러 출처의 스크립트·타일·워커를 쓰므로 CSP는
 * 클릭재킹 방지(frame-ancestors)·base/form/object 제한만 건다. Referrer는 출처만 보내 지도 키의 리퍼러 제한과 맞춘다.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // https로 받은 응답에만 브라우저가 적용한다 (로컬 http에서는 무시됨)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // 컨테이너 이미지 경량화: .next/standalone에 실행에 필요한 파일만 모은다 (Dockerfile 참고)
  output: "standalone",
  // next/image를 쓰지 않으므로 이미지 최적화(sharp, 약 46MB)를 끄고 추적에서도 뺀다
  images: { unoptimized: true },
  outputFileTracingExcludes: { "**": ["node_modules/@img/**", "node_modules/sharp/**"] },
  // 번들하지 않고 node_modules에서 그대로 로드한다.
  //  - DB 드라이버: tedious → @azure/identity → open 이 Windows 절대경로(powershell.exe)를 참조해 Turbopack 번들링이 실패함
  //  - Azure Monitor: require 후킹으로 계측하므로 번들하면 동작하지 않음
  serverExternalPackages: ["@prisma/adapter-mssql", "mssql", "tedious", "@azure/monitor-opentelemetry"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
