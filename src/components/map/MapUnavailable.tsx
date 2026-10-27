import { MapPinOffIcon } from "lucide-react";

export function MapUnavailable({ reason, className }: { reason: string; className?: string }) {
  return (
    <div className={className}>
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        <MapPinOffIcon className="size-6" aria-hidden />
        <p>지도를 표시할 수 없습니다.</p>
        <p className="text-xs">{reason}</p>
      </div>
    </div>
  );
}
