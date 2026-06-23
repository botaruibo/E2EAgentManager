import type { LocatorCandidate } from "../../locator/src/index.js";
import type { StepResult, WorkflowExpectation, WorkflowExtractSpec, WorkflowTarget } from "../../shared/src/index.js";
import type { BrowserRuntime } from "./index.js";
import { ensureBrowserProfileDir } from "./profile.js";

export interface PlaywrightBrowserRuntimeConfig {
  userDataDir: string;
  headless?: boolean;
  executablePath?: string;
  viewport?: {
    width: number;
    height: number;
  };
  timeoutMs?: number;
  actionDelayMs?: number;
}

export interface PlaywrightLike {
  chromium: {
    launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<PlaywrightContextLike>;
  };
}

export interface PlaywrightContextLike {
  pages(): PlaywrightPageLike[];
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<void>;
}

export interface PlaywrightPageLike {
  on?(eventName: string, handler: (...args: unknown[]) => void): void;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  getByRole(role: string, options?: Record<string, unknown>): PlaywrightLocatorLike;
  getByLabel(label: string, options?: Record<string, unknown>): PlaywrightLocatorLike;
  getByText(text: string, options?: Record<string, unknown>): PlaywrightLocatorLike;
  locator(selector: string): PlaywrightLocatorLike;
  keyboard?: {
    press(key: string, options?: Record<string, unknown>): Promise<void>;
  };
  waitForLoadState?(state?: string, options?: Record<string, unknown>): Promise<void>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  content(): Promise<string>;
  title(): Promise<string>;
  url(): string;
  screenshot(options?: Record<string, unknown>): Promise<Uint8Array>;
}

export interface PlaywrightLocatorLike {
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string, options?: Record<string, unknown>): Promise<void>;
  press?(key: string, options?: Record<string, unknown>): Promise<void>;
  innerText?(options?: Record<string, unknown>): Promise<string>;
  getAttribute?(name: string, options?: Record<string, unknown>): Promise<string | null>;
  count?(): Promise<number>;
  nth?(index: number): PlaywrightLocatorLike;
  locator?(selector: string): PlaywrightLocatorLike;
  ariaSnapshot?(options?: Record<string, unknown>): Promise<string>;
}

export interface LoginSessionResult {
  userDataDir: string;
  url: string;
  title: string;
  message: string;
}

interface BrowserConsoleLog {
  type: string;
  text: string;
}

interface BrowserNetworkEvent {
  type: string;
  url: string;
  method?: string;
  status?: number;
  resourceType?: string;
  errorText?: string;
}

interface LocatorAttempt {
  label: string;
  locator: PlaywrightLocatorLike;
}

export class PlaywrightBrowserRuntime implements BrowserRuntime {
  private readonly consoleLogs: BrowserConsoleLog[] = [];
  private readonly networkEvents: BrowserNetworkEvent[] = [];
  private context?: PlaywrightContextLike;
  private page?: PlaywrightPageLike;
  private observedPage?: PlaywrightPageLike;

  constructor(
    readonly config: PlaywrightBrowserRuntimeConfig,
    private readonly playwrightLoader: () => Promise<PlaywrightLike> = loadPlaywright
  ) {}

  async open(url: string, timeoutMs?: number): Promise<StepResult> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs(timeoutMs) });
    await waitForPageReady(page, this.timeoutMs(timeoutMs));
    await this.debugDelay();
    return { ok: true, message: `Opened ${url}` };
  }

  async click(candidate: LocatorCandidate, target: WorkflowTarget, timeoutMs?: number): Promise<StepResult> {
    const popupPromise = this.waitForPopupAfterClick();
    const pageBeforeClick = await this.ensurePage();
    const urlBeforeClick = pageBeforeClick.url();
    const attempts = await this.resolveLocatorAttempts(candidate, target);
    await runLocatorAttempt(attempts, (locator) => locator.click({ timeout: this.timeoutMs(timeoutMs) }), "locator.click");
    const popup = await popupPromise;
    if (popup) {
      this.page = popup;
      this.observePage(popup);
      await waitForPageReady(popup, this.timeoutMs(timeoutMs));
    } else if (this.page) {
      await waitForPageReady(this.page, this.timeoutMs(timeoutMs), this.page.url() !== urlBeforeClick);
    }
    await this.debugDelay();
    return {
      ok: true,
      message: `Clicked ${candidate.strategy}:${candidate.value}`,
      data: popup ? { openedPopupUrl: popup.url() } : undefined
    };
  }

  async input(candidate: LocatorCandidate, target: WorkflowTarget, value: string, timeoutMs?: number): Promise<StepResult> {
    const attempts = await this.resolveLocatorAttempts(candidate, target);
    await runLocatorAttempt(attempts, (locator) => locator.fill(value, { timeout: this.timeoutMs(timeoutMs) }), "locator.fill");
    await this.debugDelay();
    return { ok: true, message: `Filled ${candidate.strategy}:${candidate.value}`, data: { value } };
  }

  async press(key: string, candidate?: LocatorCandidate, target?: WorkflowTarget, timeoutMs?: number): Promise<StepResult> {
    if (candidate && target) {
      const attempts = await this.resolveLocatorAttempts(candidate, target);
      await runLocatorAttempt(attempts, async (locator) => {
        if (locator.press) {
          await locator.press(key, { timeout: this.timeoutMs(timeoutMs) });
          return;
        }
        await locator.click({ timeout: this.timeoutMs(timeoutMs) });
        const page = await this.ensurePage();
        if (!page.keyboard?.press) {
          throw new Error("Playwright page keyboard API is unavailable.");
        }
        await page.keyboard.press(key, { timeout: this.timeoutMs(timeoutMs) });
      }, "locator.press");
      if (this.page) {
        await waitForPageReady(this.page, this.timeoutMs(timeoutMs));
      }
      await this.debugDelay();
      return { ok: true, message: `Pressed ${key} on ${candidate.strategy}:${candidate.value}`, data: { key } };
    }
    const page = await this.ensurePage();
    if (!page.keyboard?.press) {
      return { ok: false, message: "Playwright page keyboard API is unavailable." };
    }
    await page.keyboard.press(key, { timeout: this.timeoutMs(timeoutMs) });
    await waitForPageReady(page, this.timeoutMs(timeoutMs));
    await this.debugDelay();
    return { ok: true, message: `Pressed ${key}`, data: { key } };
  }

  async extract(spec: WorkflowExtractSpec, timeoutMs?: number): Promise<StepResult> {
    const page = await this.ensurePage();
    await waitForDomStability(page, this.timeoutMs(timeoutMs));
    const selector = spec.selector ?? "body";
    const root = page.locator(selector);
    const maxRows = Math.max(1, Math.min(spec.limit ?? 1, 100));
    const count = root.count ? Math.min(await root.count(), maxRows) : 1;
    const rows: Record<string, unknown>[] = [];

    for (let index = 0; index < count; index += 1) {
      const item = root.nth ? root.nth(index) : root;
      if (!spec.fields || Object.keys(spec.fields).length === 0) {
        rows.push({
          index,
          text: item.innerText ? await item.innerText({ timeout: this.timeoutMs(timeoutMs) }) : undefined,
          url: page.url(),
          title: await page.title()
        });
        continue;
      }

      const row: Record<string, unknown> = { index };
      for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
        const fieldLocator = fieldSpec.selector && item.locator ? item.locator(fieldSpec.selector) : item;
        if (fieldSpec.attr && fieldLocator.getAttribute) {
          row[fieldName] = await fieldLocator.getAttribute(fieldSpec.attr, { timeout: this.timeoutMs(timeoutMs) });
        } else if (fieldLocator.innerText) {
          row[fieldName] = await fieldLocator.innerText({ timeout: this.timeoutMs(timeoutMs) });
        }
      }
      rows.push(row);
    }

    return {
      ok: true,
      message: `Extracted ${rows.length} ${spec.entity} row(s)`,
      data: {
        entity: spec.entity,
        rows
      }
    };
  }

  async verify(expectation: WorkflowExpectation, timeoutMs?: number): Promise<StepResult> {
    await waitForDomStability(this.page, this.timeoutMs(timeoutMs));
    const page = await this.ensurePage();
    const html = await page.content();
    const title = await page.title();
    const searchable = `${title}\n${html}`;

    if (expectation.textExists) {
      return searchable.includes(expectation.textExists)
        ? { ok: true, message: `Verified text ${expectation.textExists}` }
        : { ok: false, message: `Missing text ${expectation.textExists}` };
    }

    if (expectation.anyTextExists) {
      const matched = expectation.anyTextExists.find((text) => searchable.includes(text));
      return matched
        ? { ok: true, message: `Verified text ${matched}` }
        : { ok: false, message: `Missing any expected text: ${expectation.anyTextExists.join(", ")}` };
    }

    return { ok: true, message: "No expectation defined" };
  }

  async wait(timeoutMs: number): Promise<StepResult> {
    const page = await this.ensurePage();
    await page.waitForTimeout(timeoutMs);
    return { ok: true, message: `Waited ${timeoutMs}ms` };
  }

  async snapshot(): Promise<Record<string, unknown>> {
    if (!this.page) {
      return {
        adapter: "playwright",
        ready: false
      };
    }

    const html = await this.page.content();
    const domText = await captureDomText(this.page, html, this.timeoutMs());
    const accessibility = await captureAccessibilitySnapshot(this.page, this.timeoutMs());
    const snapshot: Record<string, unknown> = {
      adapter: "playwright",
      ready: true,
      url: this.page.url(),
      title: await this.page.title(),
      htmlLength: html.length,
      domTextLength: domText.length,
      domTextSample: truncateText(domText, 500),
      accessibilitySnapshot: accessibility.snapshot,
      accessibilitySnapshotError: accessibility.error,
      consoleLogs: this.consoleLogs.slice(-20),
      networkSummary: summarizeNetworkEvents(this.networkEvents),
      networkEvents: this.networkEvents.slice(-20)
    };

    try {
      const screenshot = await this.page.screenshot({ type: "png", fullPage: true });
      snapshot.screenshot = {
        mimeType: "image/png",
        bytes: screenshot.byteLength,
        base64: uint8ToBase64(screenshot)
      };
    } catch (error) {
      snapshot.screenshotError = error instanceof Error ? error.message : String(error);
    }

    return snapshot;
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    this.observedPage = undefined;
  }

  async openLoginSession(url = "https://buyin.jinritemai.com"): Promise<LoginSessionResult> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs() });
    return {
      userDataDir: this.config.userDataDir,
      url: page.url(),
      title: await page.title(),
      message: "Login browser opened. Complete Douyin Baiying login in this dedicated profile, then rerun dry_run."
    };
  }

  private async ensurePage(): Promise<PlaywrightPageLike> {
    if (this.page) {
      return this.page;
    }

    await ensureBrowserProfileDir(this.config.userDataDir);
    const playwright = await this.playwrightLoader();
    try {
      this.context = await playwright.chromium.launchPersistentContext(this.config.userDataDir, {
        headless: this.config.headless ?? false,
        executablePath: this.config.executablePath,
        viewport: this.config.viewport ?? { width: 1440, height: 900 }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        [
          `Unable to launch Playwright Chromium with profile ${this.config.userDataDir}.`,
          "Install Playwright browser binaries, or pass executablePath for a local Chromium/Chrome build.",
          "Use dry_run first and log in to Douyin Baiying in the dedicated profile before batch mode.",
          message
        ].join(" ")
      );
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.observePage(this.page);
    return this.page;
  }

  private observePage(page: PlaywrightPageLike): void {
    if (this.observedPage === page || !page.on) {
      return;
    }
    this.observedPage = page;
    page.on("console", (message) => {
      this.pushConsoleLog({
        type: readStringMethod(message, "type") ?? "log",
        text: readStringMethod(message, "text") ?? String(message)
      });
    });
    page.on("requestfailed", (request) => {
      this.pushNetworkEvent({
        type: "requestfailed",
        url: readStringMethod(request, "url") ?? "",
        method: readStringMethod(request, "method"),
        resourceType: readStringMethod(request, "resourceType"),
        errorText: readFailureText(request)
      });
    });
    page.on("response", (response) => {
      this.pushNetworkEvent({
        type: "response",
        url: readStringMethod(response, "url") ?? "",
        status: readNumberMethod(response, "status"),
        method: readStringMethod(readMethod(response, "request"), "method"),
        resourceType: readStringMethod(readMethod(response, "request"), "resourceType")
      });
    });
  }

  private pushConsoleLog(log: BrowserConsoleLog): void {
    this.consoleLogs.push(log);
    if (this.consoleLogs.length > 50) {
      this.consoleLogs.shift();
    }
  }

  private pushNetworkEvent(event: BrowserNetworkEvent): void {
    this.networkEvents.push(event);
    if (this.networkEvents.length > 50) {
      this.networkEvents.shift();
    }
  }

  private async resolveLocator(
    candidate: LocatorCandidate,
    target: WorkflowTarget
  ): Promise<PlaywrightLocatorLike> {
    const attempts = await this.resolveLocatorAttempts(candidate, target);
    return attempts[0].locator;
  }

  private async resolveLocatorAttempts(
    candidate: LocatorCandidate,
    target: WorkflowTarget
  ): Promise<LocatorAttempt[]> {
    const page = await this.ensurePage();
    const attempts: LocatorAttempt[] = [];
    const addAttempt = (label: string, locator: PlaywrightLocatorLike) => {
      if (!attempts.some((attempt) => attempt.label === label)) {
        attempts.push({ label, locator });
      }
    };

    if (candidate.strategy === "role" && target.role) {
      const names = locatorTextVariants(target.text, stripRoleCandidateValue(candidate.value));
      if (names.length === 0) {
        addAttempt(`role:${target.role}`, page.getByRole(target.role));
      } else {
        for (const name of names) {
          addAttempt(`role:${target.role}:${name}`, page.getByRole(target.role, { name, exact: false }));
        }
        for (const name of names) {
          addAttempt(`text:${name}`, page.getByText(name, { exact: false }));
        }
      }
      addTargetSelectorAttempts(addAttempt, page, target);
      return attempts;
    }
    if (candidate.strategy === "label") {
      for (const label of locatorTextVariants(target.label, candidate.value)) {
        addAttempt(`label:${label}`, page.getByLabel(label, { exact: false }));
      }
      addTargetSelectorAttempts(addAttempt, page, target);
      return attempts.length > 0 ? attempts : [{ label: `label:${candidate.value}`, locator: page.getByLabel(candidate.value) }];
    }
    if (candidate.strategy === "text") {
      for (const text of locatorTextVariants(target.text, candidate.value)) {
        addAttempt(`text:${text}`, page.getByText(text, { exact: false }));
      }
      addTargetSelectorAttempts(addAttempt, page, target);
      return attempts.length > 0 ? attempts : [{ label: `text:${candidate.value}`, locator: page.getByText(candidate.value) }];
    }
    if (candidate.strategy === "css" || candidate.strategy === "xpath") {
      return [{ label: `${candidate.strategy}:${candidate.value}`, locator: page.locator(candidate.value) }];
    }

    return [{ label: `${candidate.strategy}:${candidate.value}`, locator: page.locator(candidate.value) }];
  }

  private timeoutMs(stepTimeoutMs?: number): number {
    return stepTimeoutMs ?? this.config.timeoutMs ?? 10_000;
  }

  private async debugDelay(): Promise<void> {
    const delayMs = this.config.actionDelayMs ?? 0;
    if (delayMs <= 0 || !this.page) {
      return;
    }
    await this.page.waitForTimeout(delayMs);
  }

  private async waitForPopupAfterClick(): Promise<PlaywrightPageLike | undefined> {
    const page = this.page;
    if (!page?.on) {
      return undefined;
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (popup?: PlaywrightPageLike) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(popup);
      };
      page.on?.("popup", (popup) => {
        finish(isPageLike(popup) ? popup : undefined);
      });
      setTimeout(() => finish(undefined), 750);
    });
  }
}

function addTargetSelectorAttempts(
  addAttempt: (label: string, locator: PlaywrightLocatorLike) => void,
  page: PlaywrightPageLike,
  target: WorkflowTarget
): void {
  if (target.css) {
    addAttempt(`css:${target.css}`, page.locator(target.css));
  }
  if (target.xpath) {
    addAttempt(`xpath:${target.xpath}`, page.locator(target.xpath));
  }
}

async function runLocatorAttempt(
  attempts: LocatorAttempt[],
  action: (locator: PlaywrightLocatorLike) => Promise<void>,
  actionName: string
): Promise<void> {
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      await action(attempt.locator);
      return;
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${actionName} failed after ${attempts.length} locator attempt(s). ${errors.join(" | ")}`);
}

function locatorTextVariants(...values: Array<string | undefined>): string[] {
  const variants: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    pushUnique(variants, value);
    pushUnique(variants, stripSemanticPrefix(value));
  }
  return variants.filter(Boolean);
}

function stripRoleCandidateValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const colonIndex = value.indexOf(":");
  return colonIndex > 0 ? value.slice(colonIndex + 1) : value;
}

function stripSemanticPrefix(value: string): string {
  return value
    .trim()
    .replace(/^(标题|链接|按钮|文本|名称|选项|输入框|字段)\s*[:：]\s*/u, "")
    .trim();
}

function pushUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

async function waitForDomStability(page: PlaywrightPageLike | undefined, timeoutMs: number): Promise<void> {
  if (!page) {
    return;
  }
  await page.waitForTimeout(Math.min(timeoutMs, 250));
}

async function waitForPageReady(
  page: PlaywrightPageLike | undefined,
  timeoutMs: number,
  navigationLikely = true
): Promise<void> {
  if (!page) {
    return;
  }
  if (page.waitForLoadState) {
    if (navigationLikely) {
      await waitForLoadStateQuietly(page, "load", Math.min(timeoutMs, 8_000));
    }
    await waitForLoadStateQuietly(page, "networkidle", Math.min(timeoutMs, 1_500));
  }
  await waitForDomStability(page, timeoutMs);
}

async function waitForLoadStateQuietly(page: PlaywrightPageLike, state: string, timeoutMs: number): Promise<void> {
  try {
    await page.waitForLoadState?.(state, { timeout: timeoutMs });
  } catch {
    // Some sites keep long-polling or lazy requests open. A bounded wait is enough to sequence the next node.
  }
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    const module = (await import("playwright")) as unknown;
    if (isPlaywrightLike(module)) {
      return module;
    }
    if (isObject(module) && "default" in module && isPlaywrightLike(module.default)) {
      return module.default;
    }
    throw new Error("Loaded module does not expose chromium.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Playwright. Install dependencies before using real browser runtime. ${message}`);
  }
}

function isPlaywrightLike(value: unknown): value is PlaywrightLike {
  return isObject(value) && "chromium" in value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPageLike(value: unknown): value is PlaywrightPageLike {
  return isObject(value) && typeof value.goto === "function" && typeof value.url === "function";
}

function readMethod(value: unknown, methodName: string): unknown {
  if (!isObject(value)) {
    return undefined;
  }
  const method = value[methodName];
  return typeof method === "function" ? method.call(value) : undefined;
}

function readStringMethod(value: unknown, methodName: string): string | undefined {
  const result = readMethod(value, methodName);
  return typeof result === "string" ? result : undefined;
}

function readNumberMethod(value: unknown, methodName: string): number | undefined {
  const result = readMethod(value, methodName);
  return typeof result === "number" ? result : undefined;
}

function readFailureText(request: unknown): string | undefined {
  const failure = readMethod(request, "failure");
  return isObject(failure) && typeof failure.errorText === "string" ? failure.errorText : undefined;
}

function summarizeNetworkEvents(events: BrowserNetworkEvent[]): Record<string, number> {
  return {
    total: events.length,
    responses: events.filter((event) => event.type === "response").length,
    failed: events.filter((event) => event.type === "requestfailed").length,
    status4xx: events.filter((event) => typeof event.status === "number" && event.status >= 400 && event.status < 500).length,
    status5xx: events.filter((event) => typeof event.status === "number" && event.status >= 500).length
  };
}

async function captureDomText(page: PlaywrightPageLike, html: string, timeoutMs: number): Promise<string> {
  try {
    const body = page.locator("body");
    if (body.innerText) {
      return normalizeWhitespace(await body.innerText({ timeout: timeoutMs }));
    }
  } catch {
    // Best-effort debug evidence; fall back to HTML-derived text below.
  }
  return normalizeWhitespace(stripHtml(html));
}

async function captureAccessibilitySnapshot(
  page: PlaywrightPageLike,
  timeoutMs: number
): Promise<{ snapshot?: string; error?: string }> {
  try {
    const body = page.locator("body");
    if (!body.ariaSnapshot) {
      return {};
    }
    return {
      snapshot: truncateText(await body.ariaSnapshot({ timeout: timeoutMs }), 1000)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[third & 63] : "=";
  }
  return output;
}
