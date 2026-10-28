import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { safeExternalUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

/** "검증 필요" 노란 배지 */
export function ReviewBadge({ className, children = "검증 필요" }: { className?: string; children?: React.ReactNode }) {
  return (
    <Badge
      data-testid="review-badge"
      className={cn(
        "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300",
        className,
      )}
    >
      <TriangleAlertIcon data-icon="inline-start" aria-hidden />
      {children}
    </Badge>
  );
}

/** 외부 출처 링크. http(s)가 아닌 URL은 링크 없이 글자만 보여준다 */
export function SourceLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const safe = safeExternalUrl(href);
  if (!safe) return <span className={cn("text-xs text-muted-foreground", className)}>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-0.5 text-xs text-primary underline-offset-2 hover:underline", className)}
    >
      {children}
      <ExternalLinkIcon className="size-3" aria-hidden />
    </a>
  );
}

/** 노란 안내 상자 (이동시간 기준·부분 결과 등) */
export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "warn"
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}
