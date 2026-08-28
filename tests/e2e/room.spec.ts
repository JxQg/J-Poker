import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

interface IsolatedPage {
  context: BrowserContext;
  page: Page;
}

interface DownloadedAuditPackage {
  schemaVersion?: unknown;
  roomCode?: unknown;
  signatureAlgorithm?: unknown;
  events?: Array<{ type?: unknown }>;
}

const isolatedPage = async (browser: Browser, testInfo: TestInfo): Promise<IsolatedPage> => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("The E2E project must define a baseURL");
  const context = await browser.newContext({ baseURL });
  return { context, page: await context.newPage() };
};

const createRoom = async (page: Page, nickname: string): Promise<string> => {
  await page.goto("/");
  await page.getByTestId("create-nickname").fill(nickname);
  await page.getByTestId("create-room").click();
  const roomCode = page.getByTestId("room-code");
  await expect(roomCode).toHaveText(ROOM_CODE);
  return (await roomCode.innerText()).trim();
};

const joinRoom = async (page: Page, roomCode: string, nickname: string): Promise<void> => {
  await page.goto(`/r/${roomCode}`);
  await page.getByTestId("join-room-code").fill(roomCode);
  await page.getByTestId("join-nickname").fill(nickname);
  await page.getByTestId("join-room").click();
  await expect(page.getByTestId("room-code")).toHaveText(roomCode);
};

const expectPlayer = async (page: Page, nickname: string): Promise<void> => {
  await expect(
    page.getByTestId("player-list").getByTestId("player-name").filter({ hasText: nickname }),
  ).toBeVisible();
};

const readyPlayersAndStart = async (host: Page, guests: Page[]): Promise<void> => {
  for (const guest of guests) {
    await guest.getByTestId("ready-toggle").click();
    await expect(guest.getByTestId("ready-toggle")).toContainText("取消准备");
  }
  await expect(host.getByTestId("start-game")).toBeEnabled();
  await host.getByTestId("start-game").click();
  const pages = [host, ...guests];
  await Promise.all(
    pages.map((page) => expect(page.getByTestId("poker-table")).toBeVisible({ timeout: 20_000 })),
  );
  await Promise.all(
    pages.map((page) => expect(page.getByLabel("你的底牌")).toBeVisible({ timeout: 20_000 })),
  );
};

const attachScreenshot = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
};

const isEnabled = async (page: Page, testId: string): Promise<boolean> => {
  const action = page.getByTestId(testId);
  return (await action.count()) > 0 && (await action.isVisible()) && (await action.isEnabled());
};

const firstPageWithEnabledFold = async (pages: Page[]): Promise<Page | undefined> => {
  for (const page of pages) {
    if (await isEnabled(page, "action-fold")) return page;
  }
  return undefined;
};

const foldCurrentPlayer = async (pages: Page[]): Promise<void> => {
  await expect.poll(
    async () => Boolean(await firstPageWithEnabledFold(pages)),
    { timeout: 20_000, message: "one player should receive a foldable legal turn" },
  ).toBe(true);
  const actingPage = await firstPageWithEnabledFold(pages);
  if (!actingPage) throw new Error("No player received an enabled fold action");
  const previousHand = (await actingPage.locator(".hand-identity span").first().textContent()) ?? "";
  await actingPage.getByTestId("action-fold").click();
  await expect.poll(
    async () => {
      const currentHand = (await actingPage.locator(".hand-identity span").first().textContent()) ?? "";
      return currentHand !== previousHand || !(await isEnabled(actingPage, "action-fold"));
    },
    { timeout: 10_000, message: "the action should advance to another player" },
  ).toBe(true);
};

const holeCardLabels = async (page: Page): Promise<string[]> => {
  const cards = page.getByLabel("你的底牌").locator(".playing-card");
  await expect(cards).toHaveCount(2);
  return cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? ""));
};

const expectOpponentCardsHidden = async (page: Page, nickname: string): Promise<void> => {
  const cards = page.getByLabel(`${nickname}的底牌`);
  await expect(cards.getByLabel("暗牌")).toHaveCount(2);
  await expect(cards.locator(".playing-card:not(.card-back)")).toHaveCount(0);
};

const settlementVisible = async (pages: Page[]): Promise<boolean> => {
  for (const page of pages) {
    if (await page.locator(".settlement-strip").isVisible().catch(() => false)) return true;
  }
  return false;
};

const readyEligibleSettlers = async (pages: Page[]): Promise<void> => {
  for (const page of pages) {
    const ready = page.getByRole("button", { name: "准备下一手" });
    if ((await ready.count()) > 0 && await ready.isVisible()) await ready.click();
  }
};

test("two players can join, start a hand, act, and reconnect", async ({ browser }, testInfo) => {
  const hostClient = await isolatedPage(browser, testInfo);
  const guestClient = await isolatedPage(browser, testInfo);
  const host = hostClient.page;
  const guest = guestClient.page;

  try {
    const roomCode = await createRoom(host, "Host E2E");
    await joinRoom(guest, roomCode, "Guest E2E");

    await expectPlayer(host, "Host E2E");
    await expectPlayer(host, "Guest E2E");
    await expectPlayer(guest, "Host E2E");
    await expectPlayer(guest, "Guest E2E");

    await readyPlayersAndStart(host, [guest]);
    await attachScreenshot(host, testInfo, "two-player-table");
    const cardsBeforeReload = await holeCardLabels(host);
    await expectOpponentCardsHidden(host, "Guest E2E");

    await host.reload();
    await expect(host.getByTestId("connection-status")).toContainText("已连接", { timeout: 10_000 });
    await expect(host.getByTestId("room-code")).toHaveText(roomCode);
    await expect(host.getByTestId("poker-table")).toBeVisible();
    await expect.poll(() => holeCardLabels(host), {
      timeout: 10_000,
      message: "reconnected player should recover the same private cards",
    }).toEqual(cardsBeforeReload);
    await expectOpponentCardsHidden(host, "Guest E2E");

    await foldCurrentPlayer([host, guest]);
    await expect.poll(() => settlementVisible([host, guest]), { timeout: 10_000 }).toBe(true);
  } finally {
    await guestClient.context.close();
    await hostClient.context.close();
  }
});

test("a player joining during a hand participates in the next hand", async ({ browser }, testInfo) => {
  const hostClient = await isolatedPage(browser, testInfo);
  const guestClient = await isolatedPage(browser, testInfo);
  const lateClient = await isolatedPage(browser, testInfo);
  const host = hostClient.page;
  const guest = guestClient.page;
  const late = lateClient.page;

  try {
    const roomCode = await createRoom(host, "Late Host");
    await joinRoom(guest, roomCode, "First Guest");
    await readyPlayersAndStart(host, [guest]);

    await joinRoom(late, roomCode, "Next Hand Guest");
    await expect(late.getByText("你将在下一手加入")).toBeVisible();
    await expect(late.getByLabel("你的底牌")).toHaveCount(0);
    await expectOpponentCardsHidden(late, "Late Host");

    await foldCurrentPlayer([host, guest]);
    await expect.poll(() => settlementVisible([host, guest]), { timeout: 10_000 }).toBe(true);
    await readyEligibleSettlers([host, guest]);
    await expect(late.getByLabel("你的底牌")).toBeVisible({ timeout: 20_000 });
    await expect(late.getByText("你将在下一手加入")).toHaveCount(0);
    expect(await holeCardLabels(late)).toHaveLength(2);
    await expect(host.getByTestId("player-name").filter({ hasText: "Next Hand Guest" })).toBeVisible();
  } finally {
    await lateClient.context.close();
    await guestClient.context.close();
    await hostClient.context.close();
  }
});

test("eight isolated players can complete a hand without private-card leakage", async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  test.skip(testInfo.project.name !== "chromium", "The eight-context stress flow runs once in Chromium");

  const clients: IsolatedPage[] = [];
  try {
    const hostClient = await isolatedPage(browser, testInfo);
    clients.push(hostClient);
    const roomCode = await createRoom(hostClient.page, "Table Host");

    for (let index = 1; index < 8; index += 1) {
      const client = await isolatedPage(browser, testInfo);
      clients.push(client);
      await joinRoom(client.page, roomCode, `Player ${index + 1}`);
    }

    const pages = clients.map((client) => client.page);
    for (let index = 0; index < 8; index += 1) {
      await expectPlayer(hostClient.page, index === 0 ? "Table Host" : `Player ${index + 1}`);
    }
    await readyPlayersAndStart(hostClient.page, pages.slice(1));

    for (const page of pages) {
      await expect(page.locator(".hero-hole-cards .playing-card")).toHaveCount(2);
      await expect(page.locator(".player-seat .playing-card:not(.card-back)")).toHaveCount(0);
    }

    for (let action = 0; action < 7 && !(await settlementVisible(pages)); action += 1) {
      await foldCurrentPlayer(pages);
    }
    await expect.poll(() => settlementVisible(pages), {
      timeout: 10_000,
      message: "folding down to one player should settle the eight-player hand",
    }).toBe(true);
    await attachScreenshot(hostClient.page, testInfo, "eight-player-settlement");
  } finally {
    await Promise.all(clients.reverse().map((client) => client.context.close()));
  }
});

test("closing a room exposes a downloadable, verifiable audit package", async ({ page }) => {
  const roomCode = await createRoom(page, "Audit E2E");
  await expect(page.getByTestId("player-list")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("close-room").click();

  await expect(page.getByTestId("audit-status")).toContainText("审计材料已就绪", {
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 10_000 });
  await expect(page.getByTestId("audit-status")).toContainText("审计材料已就绪");
  await expect(page.getByTestId("audit-download")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("audit-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`river-room-${roomCode}-audit.json`);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Playwright did not persist the audit download");
  const auditPackage = JSON.parse(await readFile(downloadPath, "utf8")) as DownloadedAuditPackage;
  expect(auditPackage.schemaVersion).toBe("1.0");
  expect(auditPackage.roomCode).toBe(roomCode);
  expect(auditPackage.signatureAlgorithm).toBe("Ed25519");
  expect(auditPackage.events?.some((event) => event.type === "RoomClosed")).toBe(true);
  await expect(page.getByTestId("audit-status")).toContainText("审计通过", {
    timeout: 15_000,
  });
});
