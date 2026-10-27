import type { Metadata } from "next";
import { Suspense } from "react";
import { TripScreen, TripSkeleton } from "@/components/trip/trip-screen";

export const metadata: Metadata = { title: "여행" };

type Props = { params: Promise<{ id: string }> };

/** Cache Components: params는 요청 시점 데이터이므로 Suspense 안에서 읽는다 */
export default function TripPage({ params }: Props) {
  return (
    <Suspense fallback={<TripSkeleton />}>
      <TripScreenFromParams params={params} />
    </Suspense>
  );
}

async function TripScreenFromParams({ params }: Props) {
  const { id } = await params;
  return <TripScreen id={id} />;
}
