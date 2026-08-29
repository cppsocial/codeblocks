import { expect, test } from "@playwright/test";

test("the example uses one public script and stylesheet and shows debug controls", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  const block = page.locator("codeblock");
  await expect(block).toHaveClass(/codeblocks-root/);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.locator(".codeblocks-debug")).toBeVisible();
  await expect(page.locator("[data-theme-toggle]")).toBeVisible();
  await expect(page.locator("[data-editor-toggle]")).toBeVisible();
  await expect(page.locator("[data-status]")).toBeHidden();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('link[rel="stylesheet"][href]').count()).toBe(1);
  expect(await page.locator('script[src]').count()).toBe(1);
  expect((await block.innerText()).toLowerCase()).not.toContain("monaco");
  expect((await block.innerText()).toLowerCase()).not.toContain("clangd");
});

test("fallback and Run work before the full editor loads", async ({ page }) => {
  let compiler = "";
  let args = "";
  let source = "";
  await page.route("**/assets/runtime-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.route("https://godbolt.org/api/**", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}");
    compiler = request.compiler;
    args = request.options.userArguments;
    source = request.source;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        didExecute: true,
        stdout: [{ text: "\u001b[1;31mcolored\u001b[K output\u001b[0m" }],
        stderr: [],
        buildResult: { stderr: [] },
      }),
    });
  });

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("codeblock")).toHaveClass(/codeblocks-root/);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const fallback = page.getByLabel("C++ source code");
  await expect(fallback).toBeVisible();
  await expect(page.locator(".clangd-token-preprocessor")).toHaveText("#include");
  await expect(page.locator(".clangd-token-header")).toHaveText("<print>");
  await expect(page.locator(".clangd-token-type").first()).toHaveText("int");
  await expect(page.locator(".clangd-token-namespace").first()).toHaveText("std");
  await fallback.fill("int main() { return 7; } // before upgrade");
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-output]")).toContainText("colored output");
  expect(await page.locator("[data-output]").textContent()).not.toContain("\u001b[K");
  await expect(page.locator("[data-output] .clangd-ansi-bold").first())
    .toHaveCSS("color", "rgb(205, 49, 49)");
  expect(compiler).toBe("gsnapshot");
  expect(args).toBe("-std=c++26 -freflection");
  expect(source).toContain("before upgrade");
});

test("editor switch has matching surfaces and explicit themes", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  const block = page.locator("codeblock");
  const prefersDark = await page.evaluate(() =>
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  await expect(block).toHaveAttribute("data-theme", prefersDark ? "dark" : "light");
  await page.locator("[data-theme-toggle]").click();
  const switchedTheme = prefersDark ? "light" : "dark";
  await expect(block).toHaveAttribute("data-theme", switchedTheme);
  await expect.poll(() => page.locator(".monaco-editor").evaluate((element) =>
    getComputedStyle(element).backgroundColor,
  )).toBe(switchedTheme === "light" ? "rgb(255, 255, 255)" : "rgb(30, 30, 30)");
  await page.locator("[data-editor-toggle]").click();
  await expect(page.locator("[data-fallback]")).toBeVisible();
  await expect(page.locator(".monaco-editor")).toBeHidden();
  await expect(page.locator(".clangd-browser-fallback"))
    .toHaveCSS(
      "background-color",
      switchedTheme === "light" ? "rgb(255, 255, 255)" : "rgb(30, 30, 30)",
    );
  await page.locator("[data-editor-toggle]").click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
});

test("clangd starts once and serves multiple independent code blocks", async ({ page }) => {
  const consoleMessages: string[] = [];
  let wasmRequests = 0;
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/wasm/clangd.wasm")) wasmRequests++;
  });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(async () => {
    await (globalThis as any).CodeBlocks.ready;
    const second = document.createElement("codeblock");
    second.textContent = "int second() { return 2; }";
    document.querySelector("main")!.append(second);
  });
  await expect(page.locator(".monaco-editor")).toHaveCount(2, { timeout: 60_000 });
  await page.evaluate(async () => {
    const blocks = document.querySelectorAll<HTMLElement>("codeblock");
    const first = (globalThis as any).CodeBlocks.get(blocks[0]);
    const second = (globalThis as any).CodeBlocks.get(blocks[1]);
    await Promise.all([first.editorReady, second.editorReady, first.clangdReady]);
    first.setValue("int first_value = 1;");
    second.setValue("int second_value = 2;");
  });
  expect(await page.evaluate(() => {
    const blocks = document.querySelectorAll<HTMLElement>("codeblock");
    return Array.from(blocks, (block) => (globalThis as any).CodeBlocks.get(block).getValue());
  })).toEqual(["int first_value = 1;", "int second_value = 2;"]);
  expect(wasmRequests).toBe(1);
  expect(consoleMessages.join("\n")).not.toContain(
    "Received message which is neither a response nor a notification message",
  );
  expect(consoleMessages.join("\n")).not.toContain(
    "Unable to read file '/home/web_user'",
  );
});

test("the main API exposes Monaco options, styling, and the editor instance", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("codeblock")).toHaveClass(/codeblocks-root/);
  await page.evaluate(async () => {
    const api = await (globalThis as any).CodeBlocks.ready;
    api.configure({
      editorOptions: { fontSize: 18 },
      styles: { "editor-height": "240px" },
    });
    const block = document.createElement("codeblock");
    block.textContent = "int configured = 1;";
    document.querySelector("main")!.append(block);
  });
  await expect(page.locator("codeblock").nth(1).locator(".monaco-editor"))
    .toBeVisible({ timeout: 60_000 });
  expect(await page.locator("codeblock").nth(1).locator(".codeblocks-editor-shell")
    .evaluate((element) => getComputedStyle(element).height)).toBe("240px");
  expect(await page.evaluate(async () => {
    const block = document.querySelectorAll<HTMLElement>("codeblock")[1];
    const instance = (globalThis as any).CodeBlocks.get(block);
    const monaco = await instance.monacoReady;
    return monaco.getRawOptions().fontSize;
  })).toBe(18);
});

test("code help works under the opt-in isolation service worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("codeblock")).toHaveClass(/codeblocks-root/);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(async () => {
    const block = document.querySelector<HTMLElement>("codeblock")!;
    const instance = (globalThis as any).CodeBlocks.get(block);
    await instance.clangdReady;
    instance.setValue("int main() { return symbol_that_does_not_exist; }");
  });
  await expect(page.locator(".squiggly-error").first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("overflow widgets are not clipped by the code block", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".overflowingContentWidgets")).toHaveCSS("overflow", "visible");
  expect(await page.locator("codeblock").evaluate((element) =>
    getComputedStyle(element).overflow,
  )).toBe("visible");
});

test("tabs preserve independent sources and arbitrary container sizes relayout", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("codeblock")).toHaveClass(/codeblocks-root/);
  await expect(page.locator(".codeblocks-tabs")).toBeVisible();
  await expect(page.locator(".codeblocks-tab")).toHaveCount(2);
  await expect(page.locator(".codeblocks-tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator(".codeblocks-tab").nth(1).click();
  await expect(page.locator(".codeblocks-tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(() => page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("codeblock")!;
    return (globalThis as any).CodeBlocks.get(element).getValue();
  })).toContain("another tab");

  await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>("codeblock")!;
    const block = (globalThis as any).CodeBlocks.get(element);
    block.setValue("int changed_second = 2;");
    block.selectTab("main.cpp");
    element.style.width = "317px";
    element.style.setProperty("--codeblocks-editor-height", "233px");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator(".codeblocks-editor-shell")).toHaveCSS("height", "233px");
  await expect(page.locator("codeblock")).toHaveCSS("width", "317px");
  expect(await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>("codeblock")!;
    const block = (globalThis as any).CodeBlocks.get(element);
    const editor = await block.monacoReady;
    return {
      tabs: block.getTabs(),
      layoutWidth: editor.getLayoutInfo().width,
      hostWidth: element.querySelector(".codeblocks-editor-shell").clientWidth,
    };
  })).toEqual({
    tabs: [
      { name: "main.cpp", value: expect.stringContaining("println") },
      { name: "second.cpp", value: "int changed_second = 2;" },
    ],
    layoutWidth: 315,
    hostWidth: 315,
  });
});
