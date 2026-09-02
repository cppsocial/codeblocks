/** A small, DOM-independent language adapter used by the fallback editor. */
export interface LanguageHighlighter {
  readonly id: string;
  readonly label: string;
  highlight(element: HTMLElement): void | Promise<void>;
}
