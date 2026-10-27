import { MapIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <MapIcon className="size-5 text-primary" aria-hidden />
          TripPilot
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            새 여행
          </Link>
          <Link href="/trips" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            내 여행
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
