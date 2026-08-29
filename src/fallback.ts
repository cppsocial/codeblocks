import fallbackCss from "./fallback.css?inline";

export interface CreateCppFallbackEditorOptions {
  element: HTMLElement;
  value?: string;
}

export interface CppFallbackEditor {
  readonly element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
}

const KEYWORDS = [
  "alignas", "alignof", "asm", "auto", "break", "case", "catch", "class",
  "concept", "const", "consteval", "constexpr", "constinit", "continue",
  "co_await", "co_return", "co_yield", "decltype", "default", "delete", "do",
  "else", "enum", "explicit", "export", "extern", "for", "friend", "goto", "if",
  "inline", "namespace", "new", "noexcept", "nullptr", "operator", "private",
  "protected", "public", "requires", "return", "sizeof", "static", "static_assert",
  "struct", "switch", "template", "this", "throw", "try", "typedef", "typeid",
  "typename", "union", "using", "virtual", "volatile", "while",
];

const BUILTIN_TYPES = [
  "bool", "char", "char8_t", "char16_t", "char32_t", "double", "float", "int",
  "long", "short", "signed", "unsigned", "void", "wchar_t",
];

const TOKEN_CLASSES = {
  preprocessor: "clangd-token-preprocessor",
  header: "clangd-token-header",
  comment: "clangd-token-comment",
  string: "clangd-token-string",
  keyword: "clangd-token-keyword",
  type: "clangd-token-type",
  namespace: "clangd-token-namespace",
  number: "clangd-token-number",
} as const;

const TOKEN_PATTERN = new RegExp([
  "(?<preprocessor>^[ \\t]*#[ \\t]*[A-Za-z_]\\w*)",
  "(?<header><[^>\\n]+>)",
  "(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)",
  "(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')",
  `(?<keyword>\\b(?:${KEYWORDS.join("|")})\\b)`,
  `(?<type>\\b(?:${BUILTIN_TYPES.join("|")}|string)\\b)`,
  "(?<namespace>\\bstd\\b)",
  "(?<number>\\b(?:0[xX][\\da-fA-F']+|\\d[\\d']*(?:\\.\\d[\\d']*)?)\\b)",
].join("|"), "gm");

/** Create or enhance a native textarea-based C++ fallback editor. */
export function createCppFallbackEditor(
  options: CreateCppFallbackEditorOptions,
): CppFallbackEditor {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createCppFallbackEditor requires an HTMLElement");
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
    textarea.setAttribute("aria-label", "C++ source code");
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
    highlightCpp(code, textarea!.value);
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
    },
    onDidChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

function highlightCpp(code: HTMLElement, source: string): void {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    fragment.append(document.createTextNode(source.slice(offset, match.index)));
    const token = document.createElement("span");
    token.className = tokenClass(match.groups);
    token.textContent = match[0];
    fragment.append(token);
    offset = match.index! + match[0].length;
  }
  fragment.append(document.createTextNode(source.slice(offset)));
  code.replaceChildren(fragment);
}

function tokenClass(groups: Record<string, string> | undefined): string {
  for (const [group, className] of Object.entries(TOKEN_CLASSES)) {
    if (groups?.[group] !== undefined) return className;
  }
  return "";
}
