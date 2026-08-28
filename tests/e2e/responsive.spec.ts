import { expect, test, type Page, type TestInfo } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
};

const attachPage = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
};

test("home and lobby remain usable at supported viewport limits", async ({ page }, testInfo) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "J-POKER" })).toBeVisible();
    await expect(page.getByTestId("create-room")).toBeVisible();
    await expect(page.getByTestId("join-room")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachPage(page, testInfo, `${viewport.name}-home`);
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await page.getByTestId("create-nickname").fill("Responsive E2E");
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("player-list")).toBeVisible();
  await expect(page.getByTestId("ready-toggle")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachPage(page, testInfo, "mobile-lobby");

  await page.setViewportSize(VIEWPORTS[1]);
  await expect(page.getByTestId("player-list")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachPage(page, testInfo, "desktop-lobby");
});
