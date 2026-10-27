import { LockKeyholeIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { sanitizeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "잠금 해제" };

type SearchParams = Promise<{ next?: string; error?: string }>;

/**
 * 접근 토큰을 한 번 입력하면 /api/unlock이 httpOnly 쿠키를 설정한다. JS 없이 동작하는 일반 폼.
 * Cache Components: searchParams는 요청 시점 데이터이므로 Suspense 안에서 읽고, 껍데기는 정적으로 프리렌더한다.
 */
export default function UnlockPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4">
      <Suspense fallback={<UnlockForm nextPath="/" hasError={false} />}>
        <UnlockFormFromParams searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function UnlockFormFromParams({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams;
  return <UnlockForm nextPath={sanitizeNextPath(next)} hasError={Boolean(error)} />;
}

function UnlockForm({ nextPath, hasError }: { nextPath: string; hasError: boolean }) {
  return (
    <Card className="w-full max-w-sm">
      <form method="post" action="/api/unlock" className="contents">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyholeIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-lg">TripPilot</CardTitle>
          <CardDescription>접근 토큰을 입력하세요. 이 브라우저에 30일간 기억됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <input type="hidden" name="next" value={nextPath} />
          <Field data-invalid={hasError || undefined}>
            <FieldLabel htmlFor="token">접근 토큰</FieldLabel>
            <Input id="token" type="password" name="token" required autoFocus autoComplete="current-password" aria-invalid={hasError || undefined} />
            {hasError && <FieldError role="alert">토큰이 올바르지 않습니다.</FieldError>}
          </Field>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full">
            잠금 해제
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
