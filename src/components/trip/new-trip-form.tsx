"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorMessage } from "@/lib/api-client";
import { BUDGET_LABEL, COUNTRY_OPTIONS, TRANSPORT_LABEL, TRAVEL_STYLES } from "@/lib/labels";
import { BudgetSchema, CreateTripRequestSchema } from "@/lib/schemas";

/**
 * 서버의 CreateTripRequestSchema를 그대로 재사용하고, 화면 전용 차이(스타일 다중 선택·국가 '자동')만 덧붙인다.
 * 제출 시 다시 CreateTripRequestSchema로 파싱해 서버와 같은 규칙을 통과한 값만 보낸다.
 */
const TripFormSchema = CreateTripRequestSchema.omit({ style: true, countryCode: true, startDate: true, budget: true }).extend({
  styles: z.array(z.enum(TRAVEL_STYLES)).min(1, "여행 스타일을 하나 이상 고르세요"),
  countryCode: z.string(),
  startDate: z.union([z.iso.date(), z.literal("")]),
  budget: BudgetSchema,
});
type TripFormValues = z.input<typeof TripFormSchema>;

const AUTO = "auto";
const TRANSPORT_OPTIONS = ["transit", "driving", "walking"] as const;

export function NewTripForm() {
  const router = useRouter();
  const form = useForm<TripFormValues>({
    resolver: zodResolver(TripFormSchema),
    defaultValues: { city: "", countryCode: AUTO, days: 3, autoDays: false, startDate: "", styles: ["역사"], transport: "transit", budget: "medium" },
  });

  async function onSubmit(values: TripFormValues) {
    const body = CreateTripRequestSchema.parse({
      city: values.city,
      countryCode: values.countryCode === AUTO ? undefined : values.countryCode,
      days: values.days,
      autoDays: values.autoDays || undefined,
      startDate: values.startDate || undefined,
      style: values.styles.join(","),
      transport: values.transport,
      budget: values.budget,
    });
    try {
      const { tripId } = await api.createTrip(body);
      router.push(`/trips/${tripId}`);
    } catch (e) {
      toast.error("여행을 만들지 못했습니다", { description: errorMessage(e) });
    }
  }

  const submitting = form.formState.isSubmitting;
  const autoDays = useWatch({ control: form.control, name: "autoDays" });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Controller
            name="city"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="city">도시명</FieldLabel>
                <Input id="city" placeholder="예: 포르투, 교토, 경주" autoComplete="off" aria-invalid={fieldState.invalid} {...field} />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            name="countryCode"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="countryCode">국가</FieldLabel>
                <Select value={field.value} onValueChange={(v) => field.onChange(v ?? AUTO)}>
                  <SelectTrigger id="countryCode" className="w-full">
                    <SelectValue>{(v: string) => (v === AUTO ? "자동 감지" : COUNTRY_OPTIONS.find((c) => c.code === v)?.label ?? v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>자동 감지</SelectItem>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>같은 이름의 도시가 여러 나라에 있을 때 지정</FieldDescription>
              </Field>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="days"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="days">여행 일수</FieldLabel>
                <Input
                  id="days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={14}
                  aria-invalid={fieldState.invalid}
                  disabled={autoDays}
                  value={Number.isNaN(field.value) ? "" : field.value}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
                <FieldDescription>{autoDays ? "명소 규모로 추천 일수를 정합니다 (정하지 못하면 이 값)" : "1~14일"}</FieldDescription>
                {fieldState.error && <FieldError errors={[{ message: "1~14 사이의 숫자를 입력하세요" }]} />}
                <Controller
                  name="autoDays"
                  control={form.control}
                  render={({ field: auto }) => (
                    <Field orientation="horizontal" className="w-auto">
                      <Checkbox id="autoDays" checked={auto.value ?? false} onCheckedChange={(checked) => auto.onChange(checked === true)} />
                      <FieldLabel htmlFor="autoDays" className="font-normal">
                        잘 모르겠어요 — 추천 일수로 자동 결정
                      </FieldLabel>
                    </Field>
                  )}
                />
              </Field>
            )}
          />
          <Controller
            name="startDate"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="startDate">출발일 (선택)</FieldLabel>
                <Input id="startDate" type="date" aria-invalid={fieldState.invalid} {...field} />
                <FieldDescription>입력하면 휴무일을 피해 배치합니다</FieldDescription>
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </div>

        <Controller
          name="styles"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">여행 스타일 (여러 개 선택)</FieldLegend>
              <ToggleGroup multiple variant="outline" value={field.value} onValueChange={(v) => field.onChange(v)} className="flex-wrap">
                {TRAVEL_STYLES.map((s) => (
                  <ToggleGroupItem key={s} value={s} aria-label={s} className="px-4">
                    {s}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </FieldSet>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <Controller
            name="transport"
            control={form.control}
            render={({ field }) => (
              <FieldSet>
                <FieldLegend variant="label">이동수단</FieldLegend>
                <RadioGroup value={field.value} onValueChange={(v) => field.onChange(v)} className="flex flex-wrap gap-4">
                  {TRANSPORT_OPTIONS.map((t) => (
                    <Field key={t} orientation="horizontal" className="w-auto">
                      <RadioGroupItem value={t} id={`transport-${t}`} />
                      <FieldLabel htmlFor={`transport-${t}`} className="font-normal">
                        {TRANSPORT_LABEL[t]}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
                <FieldDescription>국내 도시는 대중교통 경로 데이터가 없어 자동차 시간으로 계산합니다</FieldDescription>
              </FieldSet>
            )}
          />
          <Controller
            name="budget"
            control={form.control}
            render={({ field }) => (
              <FieldSet>
                <FieldLegend variant="label">예산 수준</FieldLegend>
                <RadioGroup value={field.value} onValueChange={(v) => field.onChange(v)} className="flex flex-wrap gap-4">
                  {(["low", "medium", "high"] as const).map((b) => (
                    <Field key={b} orientation="horizontal" className="w-auto">
                      <RadioGroupItem value={b} id={`budget-${b}`} />
                      <FieldLabel htmlFor={`budget-${b}`} className="font-normal">
                        {BUDGET_LABEL[b]}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>
            )}
          />
        </div>
      </FieldGroup>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={submitting}>
        {submitting && <Loader2Icon className="animate-spin" />}
        일정 만들기
      </Button>
    </form>
  );
}
