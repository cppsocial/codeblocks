import fallbackCss from "./fallback.css?inline";
import { cppHighlighter } from "../../languages/cpp";
import { renderHighlightedSource } from "../../languages/render";
import type { LanguageHighlighter } from "../../languages/types";

export interface CreateFallbackEditorOptions {
  element: HTMLElement;
  value?: string;
  highlighter: LanguageHighlighter;
}

export interface FallbackEditor {
  readonly element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
}

/** Create or enhance a native textarea editor for a language adapter. */
export function createFallbackEditor(
  options: CreateFallbackEditorOptions,
): FallbackEditor {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createFallbackEditor requires an HTMLElement");
  }
  const element = options.element;
  const hadFallbackClass = element.classList.contains("clangd-browser-fallback");
  element.classList.add("clangd-browser-fallback");
  const stylesheet = document.createElement("style");
  stylesheet.dataset.clangdFallbackStyles = "";
  stylesheet.textContent = fallbackCss;
  element.prepend(stylesheet);

  let lines = element.querySelector<HTMLElement>(".clangd-fallback-lines");
  const ownsLines = !lines;
  if (!lines) {
    lines = document.createElement("div");
    lines.className = "clangd-fallback-lines";
    lines.ariaHidden = "true";
    element.prepend(lines);
  }
  let highlight = element.querySelector<HTMLElement>(".clangd-fallback-highlight");
  const ownsHighlight = !highlight;
  if (!highlight) {
    highlight = document.createElement("pre");
    highlight.className = "clangd-fallback-highlight";
    highlight.ariaHidden = "true";
    highlight.append(document.createElement("code"));
    lines.after(highlight);
  }
  let textarea = element.querySelector<HTMLTextAreaElement>("textarea");
  const ownsTextarea = !textarea;
  if (!textarea) {
    textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", `${options.highlighter.label} source code`);
    textarea.spellcheck = false;
    element.append(textarea);
  }
  if (options.value !== undefined) textarea.value = options.value;
  const code = highlight.querySelector("code")!;
  const listeners = new Set<(value: string) => void>();

  const syncScroll = () => {
    highlight!.style.transform =
      `translate(${-textarea!.scrollLeft}px, ${-textarea!.scrollTop}px)`;
    lines!.style.transform = `translateY(${-textarea!.scrollTop}px)`;
  };
  const update = () => {
    renderHighlightedSource(code, textarea!.value, options.highlighter);
    const count = textarea!.value.split("\n").length;
    lines!.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
    syncScroll();
  };
  const input = () => {
    update();
    listeners.forEach((listener) => listener(textarea!.value));
  };
  const insertTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    textarea!.setRangeText(
      "    ",
      textarea!.selectionStart,
      textarea!.selectionEnd,
      "end",
    );
    input();
  };

  textarea.addEventListener("input", input);
  textarea.addEventListener("scroll", syncScroll);
  textarea.addEventListener("keydown", insertTab);
  update();

  let disposed = false;
  return {
    element,
    getValue: () => textarea!.value,
    setValue(value) {
      textarea!.value = value;
      update();
    },
    focus: () => textarea!.focus(),
    dispose() {
      if (disposed) return;
      disposed = true;
      textarea!.removeEventListener("input", input);
      textarea!.removeEventListener("scroll", syncScroll);
      textarea!.removeEventListener("keydown", insertTab);
      listeners.clear();
      stylesheet.remove();
      if (ownsLines) lines!.remove();
      if (ownsHighlight) highlight!.remove();
      if (ownsTextarea) textarea!.remove();
      if (!hadFallbackClass) element.classList.remove("clangd-browser-fallback");
      void Promise.resolve(options.highlighter.highlight(code)).catch(() => {});
    },
    onDidChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export type CreateCppFallbackEditorOptions = Omit<
  CreateFallbackEditorOptions,
  "highlighter"
>;
export type CppFallbackEditor = FallbackEditor;

/** Convenience adapter retained for the C++-specific public API. */
export function createCppFallbackEditor(
  options: CreateCppFallbackEditorOptions,
): CppFallbackEditor {
  return createFallbackEditor({ ...options, highlighter: cppHighlighter });
}
