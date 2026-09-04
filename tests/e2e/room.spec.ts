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

interface IsolatedPageOptions {
  viewport?: { width: number; height: number };
  isMobile?: boolean;
  hasTouch?: boolean;
}

interface DownloadedAuditPackage {
  schemaVersion?: unknown;
  roomCode?: unknown;
  signatureAlgorithm?: unknown;
  events?: Array<{ type?: unknown }>;
}

const isolatedPage = async (
  browser: Browser,
  testInfo: TestInfo,
  options: IsolatedPageOptions = {},
): Promise<IsolatedPage> => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("The E2E project must define a baseURL");
  const context = await browser.newContext({ baseURL, ...options });
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

const tableGeometryIssues = async (page: Page): Promise<string[]> => page.evaluate(() => {
  type Rect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  const rectangle = (element: Element): Rect => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  };
  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    const bounds = rectangle(element);
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  };
  const overlaps = (first: Rect, second: Rect): boolean => (
    first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
  );
  const inside = (inner: Rect, outer: Rect): boolean => (
    inner.left >= outer.left
    && inner.right <= outer.right
    && inner.top >= outer.top
    && inner.bottom <= outer.bottom
  );
  const label = (element: Element): string => {
    const seat = element.closest<HTMLElement>(".player-seat")?.dataset.seat;
    return `${element.className || element.tagName}${seat ? ` seat=${seat}` : ""}`;
  };

  const surface = document.querySelector(".poker-table-surface");
  if (!surface) return ["missing .poker-table-surface"];

  const surfaceBounds = rectangle(surface);
  const viewport: Rect = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const issues: string[] = [];
  const protectedElements = [
    ...document.querySelectorAll(".community-cards, .pot-display, .hero-hole-cards, .hero-identity, .action-dock"),
  ].filter(isVisible);
  const handElements = [...document.querySelectorAll(".seat-cards")].filter(isVisible);
  const seatFrames = [
    ...document.querySelectorAll(".player-seat, .seat-cards, .seat-bet"),
  ].filter(isVisible);
  const seatDetails = [...document.querySelectorAll(".seat-details")].filter(isVisible);
  const inlineDetails = seatDetails.filter((element) => !element.classList.contains("mobile-seat-inspector"));
  const mobileInspectors = seatDetails.filter((element) => element.classList.contains("mobile-seat-inspector"));

  for (const element of [...seatFrames, ...inlineDetails]) {
    const bounds = rectangle(element);
    if (!inside(bounds, surfaceBounds)) issues.push(`${label(element)} leaves the table surface`);
    if (!inside(bounds, viewport)) issues.push(`${label(element)} leaves the viewport`);
    for (const protectedElement of protectedElements) {
      if (overlaps(bounds, rectangle(protectedElement))) {
        issues.push(`${label(element)} overlaps ${label(protectedElement)}`);
      }
    }
    if (element.classList.contains("seat-details")) {
      for (const hand of handElements) {
        if (overlaps(bounds, rectangle(hand))) issues.push(`${label(element)} overlaps ${label(hand)}`);
      }
    }
  }

  for (let index = 0; index < seatFrames.length; index += 1) {
    const first = seatFrames[index]!;
    const firstSeat = first.closest<HTMLElement>(".player-seat")?.dataset.seat;
    for (let otherIndex = index + 1; otherIndex < seatFrames.length; otherIndex += 1) {
      const second = seatFrames[otherIndex]!;
      const secondSeat = second.closest<HTMLElement>(".player-seat")?.dataset.seat;
      if (firstSeat && firstSeat === secondSeat) continue;
      if (overlaps(rectangle(first), rectangle(second))) {
        issues.push(`${label(first)} overlaps ${label(second)}`);
      }
    }
  }

  for (const inspector of mobileInspectors) {
    const bounds = rectangle(inspector);
    if (!inside(bounds, viewport)) issues.push(`${label(inspector)} leaves the viewport`);
    for (const protectedElement of [...protectedElements, ...handElements]) {
      if (overlaps(bounds, rectangle(protectedElement))) {
        issues.push(`${label(inspector)} overlaps ${label(protectedElement)}`);
      }
    }
  }

  const settlement = document.querySelector(".settlement-strip");
  if (settlement && isVisible(settlement)) {
    const bounds = rectangle(settlement);
    if (!inside(bounds, surfaceBounds)) issues.push("settlement strip leaves the table surface");
    if (!inside(bounds, viewport)) issues.push("settlement strip leaves the viewport");
    if (Math.abs((bounds.left + bounds.right) / 2 - (surfaceBounds.left + surfaceBounds.right) / 2) > 2) {
      issues.push("settlement strip is not horizontally centered in the table surface");
    }
    for (const protectedElement of [...protectedElements, ...seatFrames]) {
      if (overlaps(bounds, rectangle(protectedElement))) {
        issues.push(`settlement strip overlaps ${label(protectedElement)}`);
      }
    }
  }

  return [...new Set(issues)];
});

const attachGeometry = async (page: Page, testInfo: TestInfo, name: string): Promise<string[]> => {
  const issues = await tableGeometryIssues(page);
  const bounds = await page.evaluate(() => [...document.querySelectorAll(
    ".poker-table-surface, .community-cards, .pot-display, .hero-hole-cards, .hero-identity, .action-dock, .player-seat, .seat-cards, .seat-bet, .seat-details, .mobile-seat-inspector, .settlement-strip",
  )].map((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return {
      className: element.getAttribute("class") ?? element.tagName,
      seat: element.closest<HTMLElement>(".player-seat")?.dataset.seat ?? null,
      left,
      top,
      right,
      bottom,
      width,
      height,
    };
  }));
  await testInfo.attach(`${name}-geometry`, {
    body: Buffer.from(JSON.stringify({ issues, bounds }, null, 2)),
    contentType: "application/json",
  });
  return issues;
};

const expectNoTableCollisions = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const issues = await attachGeometry(page, testInfo, name);
  expect(issues, `geometry check for ${name}:\n${issues.join("\n")}`).toEqual([]);
};

const actionDockGeometryIssues = async (page: Page, compactViewport: boolean): Promise<string[]> => page.evaluate((isCompact) => {
  type Rect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  const rectangle = (element: Element): Rect => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  };
  const insideViewport = (bounds: Rect): boolean => (
    bounds.left >= 0
    && bounds.right <= window.innerWidth
    && bounds.top >= 0
    && bounds.bottom <= window.innerHeight
  );
  const overlaps = (first: Rect, second: Rect): boolean => (
    first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
  );
  const nearlyEqual = (first: number, second: number, tolerance = 1): boolean => Math.abs(first - second) <= tolerance;
  const issues: string[] = [];
  const dock = document.querySelector(".action-dock");
  const basicActions = document.querySelector(".basic-actions");
  const raiseControl = document.querySelector(".raise-control");
  const showHand = document.querySelector(".all-in-action");
  if (!dock || !basicActions || !raiseControl || !showHand) return ["missing action modules"];

  const primaryButtons = [...basicActions.querySelectorAll<HTMLButtonElement>(".action-button")];
  if (primaryButtons.length !== 4) issues.push(`expected four primary actions, received ${primaryButtons.length}`);
  const primaryBounds = primaryButtons.map(rectangle);
  const firstPrimary = primaryBounds[0];
  if (firstPrimary) {
    for (const [index, bounds] of primaryBounds.entries()) {
      if (!insideViewport(bounds)) issues.push(`primary action ${index + 1} leaves the viewport`);
      if (!nearlyEqual(bounds.width, firstPrimary.width) || !nearlyEqual(bounds.height, firstPrimary.height)) {
        issues.push(`primary action ${index + 1} is not equal-sized`);
      }
    }
  }
  for (let index = 0; index < primaryBounds.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < primaryBounds.length; otherIndex += 1) {
      if (overlaps(primaryBounds[index]!, primaryBounds[otherIndex]!)) {
        issues.push(`primary actions ${index + 1} and ${otherIndex + 1} overlap`);
      }
    }
  }

  const basicBounds = rectangle(basicActions);
  const raiseBounds = rectangle(raiseControl);
  const showHandBounds = rectangle(showHand);
  const slider = raiseControl.querySelector("input[type='range']");
  const amountControl = raiseControl.querySelector(".raise-amount-control");
  const lowerControls = [...raiseControl.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    ".raise-controls-row button, .raise-controls-row input",
  )];
  if (!insideViewport(raiseBounds)) issues.push("raise module leaves the viewport");
  if (!insideViewport(showHandBounds)) issues.push("SHOWHAND leaves the viewport");

  if (isCompact) {
    if (!nearlyEqual(basicBounds.width, raiseBounds.width) || !nearlyEqual(basicBounds.height, raiseBounds.height)) {
      issues.push("mobile raise module does not match the primary-action module");
    }
    if (!nearlyEqual(showHandBounds.width, basicBounds.width) || showHandBounds.top < raiseBounds.bottom) {
      issues.push("mobile SHOWHAND is not a separate full-width row");
    }
    if (lowerControls.length !== 5) issues.push(`expected five mobile raise controls, received ${lowerControls.length}`);
    const lowerBounds = lowerControls.map(rectangle);
    const firstLower = lowerBounds[0];
    if (firstLower) {
      for (const [index, bounds] of lowerBounds.entries()) {
        if (!nearlyEqual(bounds.width, firstLower.width) || !nearlyEqual(bounds.height, firstLower.height)) {
          issues.push(`mobile raise control ${index + 1} is not equal-sized`);
        }
        if (!nearlyEqual(bounds.top, firstLower.top)) issues.push(`mobile raise control ${index + 1} is not on one row`);
      }
    }
    for (let index = 0; index < lowerBounds.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < lowerBounds.length; otherIndex += 1) {
        if (overlaps(lowerBounds[index]!, lowerBounds[otherIndex]!)) {
          issues.push(`mobile raise controls ${index + 1} and ${otherIndex + 1} overlap`);
        }
      }
    }
  } else {
    if (!nearlyEqual(basicBounds.width, raiseBounds.width)) issues.push("desktop raise module width differs from the primary-action module");
    if (!nearlyEqual(basicBounds.height, raiseBounds.height) || !nearlyEqual(basicBounds.top, raiseBounds.top)) {
      issues.push("desktop primary and raise modules are not aligned");
    }
    if (!nearlyEqual(showHandBounds.height, basicBounds.height) || !nearlyEqual(showHandBounds.top, basicBounds.top)) {
      issues.push("desktop SHOWHAND is not aligned with the action modules");
    }
    if (slider && !nearlyEqual(rectangle(slider).right, raiseBounds.right)) {
      issues.push("desktop raise slider does not align to its module edge");
    }
    if (amountControl && !nearlyEqual(rectangle(amountControl).right, raiseBounds.right)) {
      issues.push("desktop raise amount controls do not align to the slider edge");
    }
  }

  if (overlaps(basicBounds, raiseBounds) || overlaps(raiseBounds, showHandBounds)) {
    issues.push("action modules overlap");
  }
  return issues;
}, compactViewport);

const expectActionDockGeometry = async (page: Page, compactViewport: boolean): Promise<void> => {
  const issues = await actionDockGeometryIssues(page, compactViewport);
  expect(issues, `action dock geometry:\n${issues.join("\n")}`).toEqual([]);
};

const expectMobileSettlementReadyInViewport = async (page: Page): Promise<void> => {
  await expect(page.getByTestId("settlement-ready")).toBeVisible();
  const issue = await page.evaluate(() => {
    const ready = document.querySelector<HTMLElement>("[data-testid='settlement-ready']");
    if (!ready) return "missing settlement ready action";
    const bounds = ready.getBoundingClientRect();
    if (bounds.height < 30) return "settlement ready action is too small";
    if (bounds.height > 36) return "settlement ready action is taller than the compact mobile control";
    if (bounds.left < 0 || bounds.right > window.innerWidth || bounds.top < 0 || bounds.bottom > window.innerHeight) {
      return "settlement ready action leaves the viewport";
    }
    return null;
  });
  expect(issue).toBeNull();
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

const firstPageWithEnabledAction = async (
  pages: Page[],
  actionTestIds: string[],
): Promise<{ page: Page; actionTestId: string } | undefined> => {
  for (const page of pages) {
    for (const actionTestId of actionTestIds) {
      if (await isEnabled(page, actionTestId)) return { page, actionTestId };
    }
  }
  return undefined;
};

const actCurrentPlayerWithoutFolding = async (pages: Page[]): Promise<void> => {
  await expect.poll(
    async () => Boolean(await firstPageWithEnabledAction(pages, ["action-check", "action-call"])),
    { timeout: 20_000, message: "one player should receive a legal check or call turn" },
  ).toBe(true);
  const current = await firstPageWithEnabledAction(pages, ["action-check", "action-call"]);
  if (!current) throw new Error("No player received a legal check or call turn");
  await current.page.getByTestId(current.actionTestId).click();
  await expect.poll(
    async () => (await settlementVisible(pages)) || !(await isEnabled(current.page, current.actionTestId)),
    { timeout: 10_000, message: "the action should advance after a check or call" },
  ).toBe(true);
};

const showHandCurrentPlayer = async (pages: Page[]): Promise<void> => {
  await expect.poll(
    async () => Boolean(await firstPageWithEnabledAction(pages, ["action-showhand"])),
    { timeout: 20_000, message: "one player should receive a legal SHOWHAND turn" },
  ).toBe(true);
  const current = await firstPageWithEnabledAction(pages, ["action-showhand"]);
  if (!current) throw new Error("No player received a legal SHOWHAND turn");
  await current.page.getByTestId(current.actionTestId).click();
  await expect.poll(
    async () => (await settlementVisible(pages)) || !(await isEnabled(current.page, current.actionTestId)),
    { timeout: 10_000, message: "the action should advance after SHOWHAND" },
  ).toBe(true);
};

const advanceToCommunityCards = async (pages: Page[]): Promise<void> => {
  for (let turn = 0; turn < 24; turn += 1) {
    const cardCount = pages[0]
      ? await pages[0].locator(".community-cards .playing-card").count()
      : 0;
    if (cardCount >= 3) return;
    await actCurrentPlayerWithoutFolding(pages);
  }
  throw new Error("The hand did not reach the flop after 24 legal actions");
};

const showHandUntilSettlement = async (pages: Page[]): Promise<void> => {
  for (let turn = 0; turn < 24 && !(await settlementVisible(pages)); turn += 1) {
    const allIn = await firstPageWithEnabledAction(pages, ["action-showhand"]);
    if (allIn) {
      await showHandCurrentPlayer(pages);
    } else {
      await actCurrentPlayerWithoutFolding(pages);
    }
  }
  await expect.poll(() => settlementVisible(pages), {
    timeout: 20_000,
    message: "all active players should reach showdown settlement",
  }).toBe(true);
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

test("desktop and mobile action modules retain their independent layout contracts", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "chromium", "The cross-viewport action layout runs once in Chromium");

  const hostClient = await isolatedPage(browser, testInfo, {
    viewport: { width: 1440, height: 900 },
  });
  const guestClient = await isolatedPage(browser, testInfo, {
    viewport: { width: 360, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  const host = hostClient.page;
  const guest = guestClient.page;

  try {
    const roomCode = await createRoom(host, "Action Host");
    await joinRoom(guest, roomCode, "Action Guest");
    await readyPlayersAndStart(host, [guest]);

    const pages = [host, guest];
    const checkedPages = new Set<Page>();
    for (let turn = 0; turn < 6 && checkedPages.size < pages.length; turn += 1) {
      const current = await firstPageWithEnabledAction(pages, ["action-fold", "action-check", "action-call", "action-showhand"]);
      if (!current) throw new Error("No player received a legal turn for action layout verification");
      await expectActionDockGeometry(current.page, current.page === guest);
      checkedPages.add(current.page);
      if (checkedPages.size < pages.length) await actCurrentPlayerWithoutFolding(pages);
    }
    expect(checkedPages.has(host)).toBe(true);
    expect(checkedPages.has(guest)).toBe(true);
  } finally {
    await guestClient.context.close();
    await hostClient.context.close();
  }
});

test("eight isolated players complete a mobile-safe showdown without private-card leakage", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "chromium", "The eight-context stress flow runs once in Chromium");

  const clients: IsolatedPage[] = [];
  try {
    const hostClient = await isolatedPage(browser, testInfo, {
      viewport: { width: 1440, height: 900 },
    });
    clients.push(hostClient);
    const roomCode = await createRoom(hostClient.page, "Table Host");

    for (let index = 1; index < 8; index += 1) {
      const client = await isolatedPage(browser, testInfo, index === 7 ? {
        viewport: { width: 360, height: 640 },
        isMobile: true,
        hasTouch: true,
      } : {
        viewport: { width: 1440, height: 900 },
      });
      clients.push(client);
      await joinRoom(client.page, roomCode, `Player ${index + 1}`);
    }

    const pages = clients.map((client) => client.page);
    const mobile = clients[7]?.page;
    if (!mobile) throw new Error("The eighth isolated client should be the mobile player");
    for (let index = 0; index < 8; index += 1) {
      await expectPlayer(hostClient.page, index === 0 ? "Table Host" : `Player ${index + 1}`);
    }
    await readyPlayersAndStart(hostClient.page, pages.slice(1));

    for (const page of pages) {
      await expect(page.locator(".hero-hole-cards .playing-card")).toHaveCount(2);
      await expect(page.locator(".player-seat .playing-card:not(.card-back)")).toHaveCount(0);
    }
    await expect(mobile.locator(".player-seat")).toHaveCount(7);
    await attachScreenshot(mobile, testInfo, "eight-player-mobile-preflop");
    await expectNoTableCollisions(mobile, testInfo, "eight-player-mobile-preflop");

    await advanceToCommunityCards(pages);
    await expect.poll(
      async () => (await mobile.locator(".community-cards .playing-card").count()) >= 3,
      { timeout: 10_000, message: "the mobile player should receive the flop" },
    ).toBe(true);
    await attachScreenshot(mobile, testInfo, "eight-player-mobile-board");
    await expectNoTableCollisions(mobile, testInfo, "eight-player-mobile-board");

    await showHandUntilSettlement(pages);
    await expect(hostClient.page.locator(".settlement-strip")).toBeVisible();
    const result = hostClient.page.locator(".log-hand-result").first();
    await expect(result).toBeVisible();
    await expect(result.locator(".log-hand-player")).toHaveCount(8);
    await expect(result.locator(".log-hand-player.folded")).toHaveCount(0);
    for (let index = 0; index < 8; index += 1) {
      const player = result.locator(".log-hand-player").nth(index);
      await expect(player.locator(".playing-card")).toHaveCount(2);
      await expect(player.locator(".log-player-hand-name")).toHaveCount(1);
    }

    await attachScreenshot(hostClient.page, testInfo, "eight-player-desktop-settlement");
    await attachScreenshot(mobile, testInfo, "eight-player-mobile-settlement");
    await expectNoTableCollisions(hostClient.page, testInfo, "eight-player-desktop-settlement");
    await expectNoTableCollisions(mobile, testInfo, "eight-player-mobile-settlement");
    await expectMobileSettlementReadyInViewport(mobile);

    for (let index = 0; index < 7; index += 1) {
      const seat = mobile.locator(".player-seat").nth(index);
      await seat.locator(".seat-shell").click();
      await expect(mobile.locator(".seat-details")).toHaveCount(1);
      await expectNoTableCollisions(mobile, testInfo, `eight-player-mobile-seat-${index + 1}-details`);
    }
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
