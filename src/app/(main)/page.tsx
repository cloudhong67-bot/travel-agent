import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTripForm } from "@/components/trip/new-trip-form";

export default function NewTripPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">어디로 떠나시나요?</h1>
        <p className="text-muted-foreground">도시 이름만 넣으면 역사·관광청 정보·명소·일자별 동선·근교 소도시까지 한 번에 정리해 드립니다.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>새 여행</CardTitle>
          <CardDescription>생성에는 보통 1~3분이 걸립니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewTripForm />
        </CardContent>
      </Card>
    </div>
  );
}
