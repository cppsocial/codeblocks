import type { LanguageHighlighter } from "./types";

/** Render highlighted source without parsing or assigning HTML. */
export function renderHighlightedSource(
  element: HTMLElement,
  source: string,
  highlighter: LanguageHighlighter,
): void {
  element.textContent = source;
  element.classList.add(`language-${highlighter.id}`);
  // Highlighting is cosmetic. Unsupported browsers and unexpected grammar
  // failures retain readable plain text instead of breaking the editor.
  void Promise.resolve(highlighter.highlight(element)).catch(() => {});
}
