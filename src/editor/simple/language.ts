import { highlightAll } from "microlighter";
import "microlighter/themes/vscode-plus.css";

export interface SimpleLanguage {
  readonly id: string;
  readonly label: string;
  highlight(element: HTMLElement): void | Promise<void>;
}

let scheduled: Promise<void> | undefined;

export function createSimpleLanguage(
  id: string,
  label = languageLabel(id),
): SimpleLanguage {
  const normalized = normalizeLanguage(id);
  return {
    id: normalized,
    label,
    highlight: scheduleHighlight,
  };
}

export const cppSimpleLanguage = createSimpleLanguage("cpp", "C++");

export function renderHighlightedSource(
  element: HTMLElement,
  source: string,
  language: SimpleLanguage,
): void {
  element.textContent = source;
  for (const className of Array.from(element.classList)) {
    if (className.startsWith("language-")) element.classList.remove(className);
  }
  element.classList.add(`language-${language.id}`);
  void Promise.resolve(language.highlight(element)).catch(() => {});
}

function scheduleHighlight(): Promise<void> {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) {
    return Promise.resolve();
  }
  if (scheduled) return scheduled;

  scheduled = new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  )
    .then(async () => {
      await highlightAll({
        root: document,
        selector:
          '.clangd-fallback-highlight > code[class*="language-"], .codeblocks-output code[class*="language-"]',
      });
    })
    .finally(() => {
      scheduled = undefined;
    });
  return scheduled;
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === "c++" || normalized === "cxx") return "cpp";
  return normalized.replace(/[^a-z0-9_+-]/g, "-") || "text";
}

function languageLabel(language: string): string {
  const normalized = normalizeLanguage(language);
  if (normalized === "cpp") return "C++";
  return normalized === "text" ? "Plain text" : language;
}
