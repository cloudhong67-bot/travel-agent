import { expect, type Page } from "@playwright/test";

export const ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN ?? "";

export async function unlock(page: Page, path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/unlock/);
  await page.getByLabel("접근 토큰").fill(ACCESS_TOKEN);
  await page.getByRole("button", { name: "잠금 해제" }).click();
}

export async function fillNewTrip(page: Page, { city, days, startDate }: { city: string; days: number; startDate?: string }) {
  await page.getByLabel("도시명").fill(city);
  await page.getByLabel("여행 일수").fill(String(days));
  if (startDate) await page.getByLabel("출발일 (선택)").fill(startDate);
  await page.getByRole("button", { name: "미식" }).click();
}

/** 제출 → 진행 화면 → 결과 화면까지 기다린다 */
export async function submitAndWaitResult(page: Page, { expectProgress = true } = {}) {
  await page.getByRole("button", { name: "일정 만들기" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
  if (expectProgress) await expect(page.getByTestId("trip-progress")).toBeVisible();
  await expect(page.getByTestId("trip-result")).toBeVisible({ timeout: 90_000 });
}
