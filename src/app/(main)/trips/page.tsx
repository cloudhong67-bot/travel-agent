import type { Metadata } from "next";
import { TripList } from "@/components/trip/trip-list";

export const metadata: Metadata = { title: "내 여행" };

export default function TripsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">내 여행</h1>
      <TripList />
    </div>
  );
}
