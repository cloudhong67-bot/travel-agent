"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 화면 렌더링 중 예상하지 못한 오류의 대체 UI (Next.js error.tsx — 헤더는 그대로 두고 본문만 바꾼다).
 * API 오류는 각 화면이 Toast로 처리하므로 여기까지 오는 것은 코드 결함·청크 로드 실패 같은 경우다.
 */
export default function MainError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[ui] 화면 오류", error);
  }, [error]);

  // 서버 컴포넌트 오류는 운영에서 메시지 대신 digest만 온다 (서버 로그와 대조용)
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <Card className="mx-auto w-full max-w-md" role="alert">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-5 text-destructive" aria-hidden />
          화면을 표시하지 못했습니다
        </CardTitle>
        <CardDescription>
          일시적인 문제일 수 있습니다. 다시 시도해도 계속되면 새로고침하세요.
          {digest && <span className="mt-1 block text-xs">오류 번호: {digest}</span>}
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        <Button onClick={() => retry()}>
          <RotateCcwIcon />
          다시 시도
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          처음으로
        </Button>
      </CardFooter>
    </Card>
  );
}
