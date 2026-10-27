import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
