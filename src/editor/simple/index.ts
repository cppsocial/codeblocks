import simpleCss from "./simple.css?inline";
import {
  cppSimpleLanguage,
  createSimpleLanguage,
  renderHighlightedSource,
  type SimpleLanguage,
} from "./language";

export * from "./language";

export interface CreateSimpleEditorOptions {
  element: HTMLElement;
  value?: string;
  language?: string | SimpleLanguage;
  readOnly?: boolean;
  highlightedLines?: number[];
}

export interface SimpleEditor {
  readonly element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  setLanguage(language: string | SimpleLanguage): void;
  setHighlightedLines(lines: number[]): void;
  focus(): void;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
}

export function createSimpleEditor(
  options: CreateSimpleEditorOptions,
): SimpleEditor {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createSimpleEditor requires an HTMLElement");
  }
  const element = options.element;
  const hadFallbackClass = element.classList.contains(
    "clangd-browser-fallback",
  );
  const previousSyntaxTheme = element.dataset.syntaxTheme;
  element.classList.add("clangd-browser-fallback");
  element.dataset.syntaxTheme = "vscode-plus";
  const stylesheet = document.createElement("style");
  stylesheet.dataset.clangdFallbackStyles = "";
  stylesheet.textContent = simpleCss;
  element.prepend(stylesheet);

  let lines = element.querySelector<HTMLElement>(".clangd-fallback-lines");
  const ownsLines = !lines;
  if (!lines) {
    lines = document.createElement("div");
    lines.className = "clangd-fallback-lines";
    lines.ariaHidden = "true";
    element.prepend(lines);
  }
  let highlight = element.querySelector<HTMLElement>(
    ".clangd-fallback-highlight",
  );
  const ownsHighlight = !highlight;
  if (!highlight) {
    highlight = document.createElement("pre");
    highlight.className = "clangd-fallback-highlight";
    highlight.ariaHidden = "true";
    highlight.append(document.createElement("code"));
    lines.after(highlight);
  }
  const lineHighlights = document.createElement("div");
  lineHighlights.className = "clangd-fallback-line-highlights";
  lineHighlights.ariaHidden = "true";
  highlight.before(lineHighlights);
  let textarea = element.querySelector<HTMLTextAreaElement>("textarea");
  const ownsTextarea = !textarea;
  if (!textarea) {
    textarea = document.createElement("textarea");
    textarea.spellcheck = false;
    element.append(textarea);
  }
  let language = resolveSimpleLanguage(options.language);
  textarea.setAttribute("aria-label", `${language.label} source code`);
  textarea.readOnly = options.readOnly ?? false;
  if (options.value !== undefined) textarea.value = options.value;
  const code = highlight.querySelector("code")!;
  const listeners = new Set<(value: string) => void>();

  const syncScroll = () => {
    highlight!.style.transform = `translate(${-textarea!.scrollLeft}px, ${-textarea!.scrollTop}px)`;
    lines!.style.transform = `translateY(${-textarea!.scrollTop}px)`;
    lineHighlights.style.transform = `translateY(${-textarea!.scrollTop}px)`;
  };
  const update = () => {
    renderHighlightedSource(code, textarea!.value, language);
    const count = textarea!.value.split("\n").length;
    lines!.textContent = Array.from(
      { length: count },
      (_, index) => index + 1,
    ).join("\n");
    syncScroll();
  };
  const input = () => {
    update();
    listeners.forEach((listener) => listener(textarea!.value));
  };
  const insertTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || textarea!.readOnly) return;
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
  const setHighlightedLines = (highlighted: number[]) => {
    lineHighlights.replaceChildren(
      ...highlighted.map((line) => {
        const marker = document.createElement("span");
        marker.style.setProperty("--clangd-highlight-line", String(line));
        return marker;
      }),
    );
  };
  setHighlightedLines(options.highlightedLines ?? []);
  update();

  let disposed = false;
  return {
    element,
    getValue: () => textarea!.value,
    setValue(value) {
      textarea!.value = value;
      update();
    },
    setLanguage(value) {
      language = resolveSimpleLanguage(value);
      textarea!.setAttribute("aria-label", `${language.label} source code`);
      update();
    },
    setHighlightedLines,
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
      lineHighlights.remove();
      if (!hadFallbackClass)
        element.classList.remove("clangd-browser-fallback");
      if (previousSyntaxTheme === undefined) delete element.dataset.syntaxTheme;
      else element.dataset.syntaxTheme = previousSyntaxTheme;
      void Promise.resolve(language.highlight(code)).catch(() => {});
    },
    onDidChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export type CreateCppSimpleEditorOptions = Omit<
  CreateSimpleEditorOptions,
  "language"
>;
export type CppSimpleEditor = SimpleEditor;

export function createCppSimpleEditor(
  options: CreateCppSimpleEditorOptions,
): CppSimpleEditor {
  return createSimpleEditor({ ...options, language: cppSimpleLanguage });
}

function resolveSimpleLanguage(
  language: string | SimpleLanguage | undefined,
): SimpleLanguage {
  if (!language) return cppSimpleLanguage;
  return typeof language === "string"
    ? createSimpleLanguage(language)
    : language;
}
