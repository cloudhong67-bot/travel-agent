import { expect, test } from "@playwright/test";
import { fillNewTrip, unlock } from "./helpers";

/** 스모크: 토큰 입력 → 여행 생성(외부 API는 MSW 목, DB는 실제) → 진행 → 결과 탭 4개 확인 */
test("토큰 입력 → 여행 생성 → 결과 탭 확인", async ({ page }) => {
  await unlock(page);
  await expect(page.getByRole("heading", { name: "어디로 떠나시나요?" })).toBeVisible();

  await fillNewTrip(page, { city: "포르투", days: 2, startDate: "2027-05-03" });
  await page.getByRole("button", { name: "일정 만들기" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);

  // 진행 화면: 단계 목록과 진행률
  const progress = page.getByTestId("trip-progress");
  await expect(progress).toBeVisible();
  await expect(progress.getByText("동선 최적화")).toBeVisible();
  await expect(progress.getByRole("progressbar")).toBeVisible();

  // done → 결과 화면
  const result = page.getByTestId("trip-result");
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result.getByRole("heading", { level: 1 })).toHaveText("포르토");

  // 배경지식
  await expect(page.getByText("포르투는 로마 시대부터 이어진 항구 도시다.")).toBeVisible();
  await expect(page.getByRole("link", { name: /위키백과/ }).first()).toBeVisible();
  // 원문에 없던 기후·매너는 비우지 않고 AI 요약 정보로 표시 (출처 링크 대신 참고 안내)
  await expect(page.getByTestId("background-bestTime").getByText("AI 요약 정보")).toBeVisible();
  await expect(page.getByTestId("background-bestTime").getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("background-history").getByText("AI 요약 정보")).toHaveCount(0);

  // 추천 체류 일수
  await expect(page.getByTestId("recommended-stay")).toHaveText(/\d박 \d일/);

  // 관광청·명소 (공식 출처 카드 + 카테고리 필터)
  await page.getByRole("tab", { name: "관광청·명소" }).click();
  await expect(page.getByText("visitporto.travel")).toBeVisible();
  const pois = page.getByTestId("poi-list").getByRole("listitem");
  const all = await pois.count();
  await page.getByRole("button", { name: "맛집" }).click();
  await expect(pois).not.toHaveCount(all);

  // 일정·동선 (타임라인 + 지도)
  await page.getByRole("tab", { name: "일정·동선" }).click();
  await expect(page.getByTestId("day-0")).toBeVisible();
  await expect(page.getByTestId("day-0").getByText("숙소 거점 출발")).toBeVisible();
  await expect(page.getByRole("button", { name: "이 날 다시 만들기" })).toBeVisible();
  await expect(page.getByTestId("google-map")).toBeAttached();

  // 근교 소도시
  await page.getByRole("tab", { name: "근교 소도시" }).click();
  await expect(page.getByTestId("nearby-list").getByRole("listitem").filter({ hasText: "브라가" })).toBeVisible();
  await expect(page.getByText("당일치기").first()).toBeVisible();

  // 일정 조정: 3일로 늘리고 요청을 적으면 진행 화면을 거쳐 3일 일정으로 바뀐다
  await page.getByTestId("schedule-panel").getByRole("button", { name: "일정 조정" }).click();
  const panel = page.getByTestId("schedule-panel");
  await panel.getByLabel("여행 일수").fill("3");
  await panel.getByLabel("일정 요청 (선택)").fill("둘째 날은 미술관 위주");
  await page.getByRole("button", { name: "이 조건으로 다시 만들기" }).click();
  await expect(page.getByTestId("trip-progress").getByText("2박 3일 일정으로 조정하는 중", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trip-result")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("tab", { name: "일정·동선" }).click();
  await expect(page.getByRole("group", { name: "일자 선택" }).getByRole("button", { name: /3일차/ })).toBeVisible();
  await expect(page.getByText(/^2박 3일 ·/)).toBeVisible();

  // 목록에 나타난다
  await page.getByRole("link", { name: "내 여행" }).click();
  await expect(page.getByTestId("trip-list").getByText("포르투").first()).toBeVisible();
});

test("API는 토큰 없이 401 { code, message }", async ({ request }) => {
  const res = await request.get("/api/v1/trips");
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
});
