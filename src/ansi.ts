export interface AppendAnsiOptions {
  className?: string;
}

interface AnsiState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  background: string;
}

const ANSI_COLORS = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510",
  "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543",
  "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
];

/** Safely render ANSI SGR text without using innerHTML. */
export function ansiToFragment(
  value: string,
  options: AppendAnsiOptions = {},
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendAnsi(fragment, value, options);
  return fragment;
}

/** Append ANSI SGR text as text nodes and styled spans. */
export function appendAnsi(
  parent: ParentNode,
  value: string,
  options: AppendAnsiOptions = {},
): void {
  const state: AnsiState = {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    color: "",
    background: "",
  };
  const pattern = /\x1b\[([0-9;]*)m/g;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    appendSegment(parent, value.slice(offset, match.index), state, options.className);
    applyCodes(state, (match[1] || "0").split(";").map(Number));
    offset = match.index! + match[0].length;
  }
  appendSegment(parent, value.slice(offset), state, options.className);
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function appendSegment(
  parent: ParentNode,
  value: string,
  state: AnsiState,
  className = "",
): void {
  if (!value) return;
  const span = document.createElement("span");
  span.textContent = value;
  span.className = [
    className,
    state.bold && "clangd-ansi-bold",
    state.dim && "clangd-ansi-dim",
    state.italic && "clangd-ansi-italic",
    state.underline && "clangd-ansi-underline",
  ].filter(Boolean).join(" ");
  if (state.color) span.style.color = state.color;
  if (state.background) span.style.backgroundColor = state.background;
  if (state.bold) span.style.fontWeight = "700";
  if (state.dim) span.style.opacity = ".7";
  if (state.italic) span.style.fontStyle = "italic";
  if (state.underline) span.style.textDecoration = "underline";
  parent.appendChild(span);
}

function applyCodes(state: AnsiState, codes: number[]): void {
  for (const code of codes) {
    if (code === 0) {
      Object.assign(state, {
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        color: "",
        background: "",
      });
    } else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 22) { state.bold = false; state.dim = false; }
    else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code === 39) state.color = "";
    else if (code === 49) state.background = "";
    else if (code >= 30 && code <= 37) state.color = ANSI_COLORS[code - 30];
    else if (code >= 90 && code <= 97) state.color = ANSI_COLORS[code - 90 + 8];
    else if (code >= 40 && code <= 47) state.background = ANSI_COLORS[code - 40];
    else if (code >= 100 && code <= 107) state.background = ANSI_COLORS[code - 100 + 8];
  }
}
