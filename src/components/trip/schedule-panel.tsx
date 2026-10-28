"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { stayLabel } from "@/lib/labels";
import { RescheduleTripRequestSchema, type TripDetail } from "@/lib/schemas";

/** 서버와 같은 RescheduleTripRequestSchema를 쓰고, 화면 전용 차이(날짜 빈 칸 = 날짜 미정)만 덧붙인다 */
const ScheduleFormSchema = RescheduleTripRequestSchema.omit({ startDate: true }).extend({
  startDate: z.union([z.iso.date(), z.literal("")]),
});
type ScheduleFormValues = z.input<typeof ScheduleFormSchema>;
type ScheduleFormOutput = z.output<typeof ScheduleFormSchema>;

/**
 * 추천 체류 일수 + 일정 조정.
 *  - 추천 일수가 지금 일정과 다르면 "추천 일수로 다시 만들기"를 바로 제안한다
 *  - "일정 조정"에서 일수·출발일·요청(예: 둘째 날은 미술관 위주)을 바꿔 일정 전체를 다시 만든다
 */
export function SchedulePanel({ trip, onRescheduling }: { trip: TripDetail; onRescheduling: (title: string) => void }) {
  const stay = trip.meta?.recommendedStay ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<ScheduleFormValues, unknown, ScheduleFormOutput>({
    resolver: zodResolver(ScheduleFormSchema),
    defaultValues: { days: trip.days, startDate: trip.startDate?.slice(0, 10) ?? "", request: "" },
  });

  async function submit(values: ScheduleFormOutput) {
    if (busy) return;
    setBusy(true);
    const body = RescheduleTripRequestSchema.parse({
      days: values.days,
      startDate: values.startDate || null,
      request: values.request?.trim() || undefined,
    });
    try {
      await api.rescheduleTrip(trip.id, body);
      toast.success(`${stayLabel(body.days)} 일정으로 다시 만드는 중입니다`);
      onRescheduling(`${stayLabel(body.days)} 일정으로 조정하는 중`);
    } catch (e) {
      toast.error("일정을 조정하지 못했습니다", { description: errorMessage(e) });
      setBusy(false);
    }
  }

  const submitting = busy;
  const differs = stay !== null && stay.days !== trip.days;

  return (
    <Card size="sm" data-testid="schedule-panel">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-primary" aria-hidden />
          {stay ? (
            <>
              추천 체류 <span data-testid="recommended-stay">{stayLabel(stay.days)}</span>
              <span className="font-normal text-muted-foreground">· 지금 일정 {stayLabel(trip.days)}</span>
            </>
          ) : (
            <>지금 일정 {stayLabel(trip.days)}</>
          )}
        </CardTitle>
        {stay && <CardDescription>{stay.reason}</CardDescription>}
      </CardHeader>
      {open && (
        <CardContent>
          <form id="schedule-form" onSubmit={form.handleSubmit(submit)} noValidate>
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  name="days"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="schedule-days">여행 일수</FieldLabel>
                      <Input
                        id="schedule-days"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={14}
                        aria-invalid={fieldState.invalid}
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                      <FieldDescription>{Number.isFinite(field.value) ? stayLabel(field.value) : "1~14일"}</FieldDescription>
                      {fieldState.error && <FieldError errors={[{ message: "1~14 사이의 숫자를 입력하세요" }]} />}
                    </Field>
                  )}
                />
                <Controller
                  name="startDate"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="schedule-start">출발일 (선택)</FieldLabel>
                      <Input id="schedule-start" type="date" aria-invalid={fieldState.invalid} {...field} />
                      <FieldDescription>비우면 날짜 미정 (요일별 휴무 검사 생략)</FieldDescription>
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="request"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="schedule-request">일정 요청 (선택)</FieldLabel>
                    <Input id="schedule-request" maxLength={300} placeholder="예: 둘째 날은 미술관 위주, 마지막 날은 오전만" aria-invalid={fieldState.invalid} {...field} />
                    <FieldDescription>특정 날의 주제·시간 조건을 적으면 배분에 반영합니다 (명소 목록 밖 장소는 추가되지 않음)</FieldDescription>
                    {fieldState.error && <FieldError errors={[{ message: "300자 이내로 적어 주세요" }]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap gap-2">
        {differs && !open && (
          <Button size="sm" disabled={submitting} onClick={() => void submit({ days: stay.days, startDate: trip.startDate?.slice(0, 10) ?? "" })}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            추천 {stayLabel(stay.days)}로 다시 만들기
          </Button>
        )}
        {open ? (
          <>
            <Button size="sm" type="submit" form="schedule-form" disabled={submitting}>
              {submitting && <Loader2Icon className="animate-spin" />}이 조건으로 다시 만들기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              취소
            </Button>
            {stay && (
              <Button size="sm" variant="outline" onClick={() => form.setValue("days", stay.days, { shouldValidate: true })}>
                추천 일수 넣기
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <CalendarClockIcon />
            일정 조정
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
