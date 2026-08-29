import { expect, test } from "@playwright/test";

test("fallback and Run remain usable while the cross-origin runtime is slow", async ({ page }) => {
  let compiledSource = "";
  await page.route("https://godbolt.org/api/**", async (route) => {
    compiledSource = JSON.parse(route.request().postData() ?? "{}").source;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ didExecute: true, code: 0, stdout: [{ text: "\u001b[1;31mearly run\u001b[0m" }], stderr: [], buildResult: { stderr: [] } }),
    });
  });

  await page.goto("http://localhost:4173/?delay=5000", { waitUntil: "domcontentloaded" });
  const fallback = page.getByLabel("C++ source code");
  await expect(fallback).toBeVisible();
  await expect(page.locator(".clangd-token-preprocessor")).toHaveText("#include <iostream>");
  await expect(page.locator(".clangd-fallback-lines")).toContainText("7");
  await fallback.fill("int main() { return 7; } // before Monaco");
  await expect(page.locator("[data-run]")).toBeEnabled();
  await expect(page.getByText("Open in Compiler Explorer (new tab)")).toBeVisible();
  await expect(page.locator("[data-output-drawer]")).toBeHidden();

  await page.locator("[data-run]").click();
  await expect(page.locator("[data-output-drawer]")).toBeVisible();
  await expect(page.locator("[data-output]")).toContainText("early run");
  await expect(page.locator("[data-output] .clangd-ansi-bold")).toHaveCSS("color", "rgb(205, 49, 49)");
  expect(await page.locator("[data-output]").textContent()).not.toContain("\u001b[");
  expect(compiledSource).toContain("before Monaco");
});

test("cross-origin Monaco handoff preserves edits, layout, and host DOM", async ({ page }) => {
  let compiledSource = "";
  await page.route("https://godbolt.org/api/**", async (route) => {
    compiledSource = JSON.parse(route.request().postData() ?? "{}").source;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ didExecute: true, code: 0, stdout: [{ text: "Monaco run" }], stderr: [], buildResult: { stderr: [] } }),
    });
  });
  await page.route("**/wasm/clangd.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.continue();
  });
  await page.goto("http://localhost:4173/?delay=800", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.evaluate(() => {
    const fallback = document.querySelector("[data-fallback]")!;
    const textarea = fallback.querySelector("textarea")!;
    textarea.value += "\n// typed during Monaco startup";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    (window as any).hostNodes = {
      run: document.querySelector("[data-run]"),
      link: document.querySelector("a"),
      output: document.querySelector("[data-output-drawer]"),
      height: document.querySelector(".editor-shell")!.getBoundingClientRect().height,
    };
  });

  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-fallback]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).cppEditor.getValue())).toContain("typed during Monaco startup");
  expect(await page.evaluate(() => {
    const refs = (window as any).hostNodes;
    return refs.run === document.querySelector("[data-run]") &&
      refs.link === document.querySelector("a") &&
      refs.output === document.querySelector("[data-output-drawer]") &&
      refs.height === document.querySelector(".editor-shell")!.getBoundingClientRect().height;
  })).toBe(true);
  await expect(page.locator("[data-status]")).toContainText("loading clangd", { ignoreCase: true });
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-output]")).toContainText("Monaco run");
  expect(compiledSource).toContain("typed during Monaco startup");

  await page.locator("[data-editor-toggle]").click();
  await expect(page.locator("[data-fallback]")).toBeVisible();
  await expect(page.locator(".monaco-editor")).toBeHidden();
  const fallbackContentX = await page.locator(".clangd-fallback-highlight").evaluate((element) => element.getBoundingClientRect().x);
  await page.getByLabel("C++ source code").fill("int toggled_fallback = 1;");
  await page.locator("[data-editor-toggle]").click();
  await expect(page.locator("[data-fallback]")).toHaveCount(0);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => (window as any).cppEditor.getValue())).toContain("toggled_fallback");
  const monacoContentX = await page.locator(".monaco-editor .view-lines").evaluate((element) => element.getBoundingClientRect().x);
  expect(Math.abs(fallbackContentX - monacoContentX)).toBeLessThanOrEqual(6);
});

test("clangd pthreads start cross-origin and provide diagnostics", async ({ page }) => {
  await page.route("https://godbolt.org/api/**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ didExecute: true, code: 0, stdout: [{ text: "Run after clangd" }], stderr: [], buildResult: { stderr: [] } }),
  }));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => (window as any).cppEditor.clangdReady);
  await expect(page.locator("[data-status]")).toHaveText("Monaco + clangd ready");
  await page.evaluate(() => (window as any).cppEditor.setValue("int main() { return symbol_that_does_not_exist; }"));
  await expect(page.locator(".squiggly-error").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-output]")).toContainText("Run after clangd");
  expect(errors.filter((value) => /worker|security|cross-origin/i.test(value))).toEqual([]);
});

test("the same package works below /assets/clangd on the host origin", async ({ page }) => {
  await page.goto("http://localhost:4175/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-fallback]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).cppEditor.getValue())).toContain("Hello from the browser");
});

test("runtime failure leaves the fallback editor intact", async ({ page }) => {
  await page.goto("http://localhost:4173/?runtime=http://localhost:4174/missing.js", { waitUntil: "networkidle" });
  const fallback = page.getByLabel("C++ source code");
  await expect(fallback).toBeVisible();
  await fallback.fill("still editable");
  await expect(fallback).toHaveValue("still editable");
  await expect(page.locator("[data-status]")).toContainText("runtime unavailable");
});

test("clangd failure leaves Monaco usable", async ({ page }) => {
  await page.route("**/wasm/clangd.wasm", (route) => route.abort("failed"));
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-status]")).toContainText("clangd unavailable");
  await page.evaluate(() => (window as any).cppEditor.setValue("int usable_without_clangd = 1;"));
  expect(await page.evaluate(() => (window as any).cppEditor.getValue())).toContain("usable_without_clangd");
});

test("a non-isolated host gets Monaco and a useful clangd error", async ({ page }) => {
  await page.goto("http://localhost:4176/", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-status]")).toContainText("clangd unavailable");
  await page.evaluate(() => (window as any).cppEditor.setValue("int basic_editor_still_works;"));
  expect(await page.evaluate(() => (window as any).cppEditor.getValue())).toContain("basic_editor_still_works");
});
