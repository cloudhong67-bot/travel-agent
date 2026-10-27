"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate, STATUS_LABEL, TRANSPORT_LABEL } from "@/lib/labels";
import type { TripSummary } from "@/lib/schemas";

export function TripList() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);

  useEffect(() => {
    api.listTrips().then(
      (r) => setTrips(r.items),
      (e) => {
        setTrips([]);
        toast.error("목록을 불러오지 못했습니다", { description: errorMessage(e) });
      },
    );
  }, []);

  async function remove(trip: TripSummary) {
    try {
      await api.deleteTrip(trip.id);
      setTrips((prev) => prev?.filter((t) => t.id !== trip.id) ?? null);
      toast.success(`${trip.cityName} 여행을 삭제했습니다`);
    } catch (e) {
      toast.error("삭제하지 못했습니다", { description: errorMessage(e) });
    }
  }

  if (trips === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy aria-label="불러오는 중">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-muted-foreground">아직 만든 여행이 없습니다.</p>
        <Button render={<Link href="/" />}>
          <PlusIcon />새 여행 만들기
        </Button>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="trip-list">
      {trips.map((t) => (
        <li key={t.id}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>
                <Link href={`/trips/${t.id}`} className="hover:underline">
                  {t.cityName}
                </Link>
              </CardTitle>
              <CardDescription>
                {t.days}일 · {TRANSPORT_LABEL[t.transport] ?? t.transport} · {formatDate(t.createdAt)}
              </CardDescription>
              <CardAction>
                <Badge variant={t.status === "failed" ? "destructive" : t.status === "done" ? "secondary" : "default"}>{STATUS_LABEL[t.status]}</Badge>
              </CardAction>
            </CardHeader>
            {(t.status === "running" || t.status === "queued") && (
              <div className="px-4">
                <Progress value={t.progress} aria-label="진행률" />
              </div>
            )}
            <CardFooter className="mt-auto justify-between gap-2">
              <Button variant="outline" size="sm" render={<Link href={`/trips/${t.id}`} />}>
                열기
              </Button>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label={`${t.cityName} 여행 삭제`} />}>
                  <Trash2Icon />
                  삭제
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.cityName} 여행을 삭제할까요?</AlertDialogTitle>
                    <AlertDialogDescription>일정·동선·근교 도시 정보가 함께 삭제되며 되돌릴 수 없습니다.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void remove(t)}>
                      삭제
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  );
}
