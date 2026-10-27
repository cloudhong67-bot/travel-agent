import { expect, test, type Page } from "@playwright/test";
import { fillNewTrip, unlock } from "./helpers";

/**
 * 화면별 스크린샷 (docs/screenshots/). 스모크와 분리: npm run e2e:screens
 */
const DIR = "docs/screenshots";
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });

test.describe.configure({ mode: "serial" });

test("@screens 데스크톱·모바일·다크 모드 화면", async ({ page, browser }) => {
  // 1. 잠금 해제
  await page.goto("/");
  await expect(page.getByLabel("접근 토큰")).toBeVisible();
  await shot(page, "01-unlock");
  await unlock(page);

  // 2. 새 여행
  await fillNewTrip(page, { city: "포르투", days: 3, startDate: "2027-05-03" });
  await shot(page, "02-new-trip");

  // 3. 진행
  await page.getByRole("button", { name: "일정 만들기" }).click();
  await expect(page.getByTestId("trip-progress")).toBeVisible();
  await expect(page.locator('[data-step="collect"][data-state="done"]')).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-progress");

  // 4. 결과 탭 4개
  await expect(page.getByTestId("trip-result")).toBeVisible({ timeout: 90_000 });
  const tripUrl = page.url();
  await shot(page, "04-result-background");
  await page.getByRole("tab", { name: "관광청·명소" }).click();
  await shot(page, "05-result-tourism");
  await page.getByRole("tab", { name: "일정·동선" }).click();
  // 지도 컨테이너가 실제 높이를 가져야 한다 (높이 0 회귀 방지)
  expect((await page.getByTestId("google-map").boundingBox())?.height ?? 0).toBeGreaterThan(300);
  await page.waitForTimeout(3_000); // 지도 타일 로드
  await shot(page, "06-result-itinerary");
  await page.getByRole("button", { name: "2일차" }).click();
  await page.waitForTimeout(1_500);
  await shot(page, "07-result-itinerary-day2");
  await page.getByRole("tab", { name: "근교 소도시" }).click();
  await shot(page, "08-result-nearby");

  // 5. 목록 + 삭제 확인 다이얼로그
  await page.getByRole("link", { name: "내 여행" }).click();
  await expect(page.getByTestId("trip-list")).toBeVisible();
  await shot(page, "09-trips");
  await page.getByRole("button", { name: /여행 삭제/ }).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.screenshot({ path: `${DIR}/10-delete-dialog.png` });
  await page.getByRole("button", { name: "취소" }).click();

  // 6. 모바일 375px (탭·지도 세로 배치)
  const cookies = await page.context().cookies();
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
  await mobile.addCookies(cookies);
  const m = await mobile.newPage();
  await m.goto(tripUrl);
  await expect(m.getByTestId("trip-result")).toBeVisible();
  await shot(m, "11-mobile-result");
  await m.getByRole("tab", { name: "일정·동선" }).click();
  // 탭 목록과 일자 버튼이 겹치지 않아야 한다 (모바일 2×2 탭 회귀 방지)
  const tabsBottom = await m.getByRole("tablist").boundingBox();
  const dayButtons = await m.getByRole("group", { name: "일자 선택" }).boundingBox();
  expect(dayButtons!.y).toBeGreaterThanOrEqual(tabsBottom!.y + tabsBottom!.height);
  await m.waitForTimeout(3_000);
  await shot(m, "12-mobile-itinerary");
  await m.goto("/");
  await shot(m, "13-mobile-new-trip");
  await mobile.close();

  // 7. 다크 모드
  const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", locale: "ko-KR" });
  await dark.addCookies(cookies);
  const d = await dark.newPage();
  await d.goto(tripUrl);
  await expect(d.getByTestId("trip-result")).toBeVisible();
  await d.getByRole("tab", { name: "일정·동선" }).click();
  await d.waitForTimeout(3_000);
  await shot(d, "14-dark-itinerary");
  await dark.close();
});

test("@screens 국내 도시(경주) — Naver 지도·자동차 기준 안내", async ({ page }) => {
  await unlock(page);
  await fillNewTrip(page, { city: "경주", days: 2 });
  await page.getByRole("button", { name: "일정 만들기" }).click();
  await expect(page.getByTestId("trip-result")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("자동차 기준으로 계산했습니다")).toBeVisible();
  await page.getByRole("tab", { name: "일정·동선" }).click();
  await expect(page.getByTestId("naver-map")).toBeAttached();
  await page.waitForTimeout(3_000);
  await shot(page, "15-kr-itinerary-naver");
});
