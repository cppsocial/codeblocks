import { highlightAll } from "microlighter";
import type { LanguageHighlighter } from "./types";

let scheduled: Promise<void> | undefined;

function supportsCustomHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

function highlightCpp(): Promise<void> {
  if (!supportsCustomHighlights()) return Promise.resolve();
  if (scheduled) return scheduled;

  // The registry is shared by the document. Scan every fallback together so
  // refreshing one editor never removes the ranges belonging to another.
  scheduled = new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  })
    .then(async () => {
      await highlightAll({
        root: document,
        selector: ".clangd-fallback-highlight > code.language-cpp",
      });
    })
    .finally(() => {
      scheduled = undefined;
    });
  return scheduled;
}

export const cppHighlighter: LanguageHighlighter = {
  id: "cpp",
  label: "C++",
  highlight: highlightCpp,
};
