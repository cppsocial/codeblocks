import type { SourceTab } from "./element-options";

export interface CodeBlockView {
  tabButtons: HTMLButtonElement[];
  editorShell: HTMLDivElement;
  fallbackHost: HTMLDivElement;
  monacoHost: HTMLDivElement;
  runButton: HTMLButtonElement;
  editorToggle: HTMLButtonElement;
  themeToggle: HTMLButtonElement;
  compilerLink: HTMLAnchorElement;
  outputDrawer: HTMLElement;
  output: HTMLPreElement;
}

export function createCodeBlockView(
  root: HTMLElement,
  tabs: SourceTab[],
  showDebugControls: boolean,
  selectTab: (index: number) => void,
): CodeBlockView {
  const tabBar = document.createElement("div");
  tabBar.className = "codeblocks-tabs";
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Source files");
  const tabButtons = tabs.map((tab, index) => {
    const tabButton = button(tab.name, true);
    tabButton.className = "codeblocks-tab";
    tabButton.dataset.tabIndex = String(index);
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", index === 0 ? "true" : "false");
    tabButton.tabIndex = index === 0 ? 0 : -1;
    tabButton.addEventListener("click", () => selectTab(index));
    tabBar.append(tabButton);
    return tabButton;
  });

  const editorShell = document.createElement("div");
  editorShell.className = "codeblocks-editor-shell";
  const fallbackHost = document.createElement("div");
  fallbackHost.className = "codeblocks-fallback";
  fallbackHost.dataset.fallback = "";
  const monacoHost = document.createElement("div");
  monacoHost.className = "codeblocks-monaco";
  monacoHost.dataset.monacoHost = "";
  monacoHost.setAttribute("aria-label", "C++ code editor");
  editorShell.append(fallbackHost, monacoHost);

  const toolbar = document.createElement("div");
  toolbar.className = "codeblocks-toolbar";
  const runButton = button("Run");
  runButton.dataset.run = "";
  const debugControls = document.createElement("span");
  debugControls.className = "codeblocks-debug";
  debugControls.hidden = !showDebugControls;
  const editorToggle = button("Show basic editor", true);
  editorToggle.dataset.editorToggle = "";
  editorToggle.disabled = true;
  const themeToggle = button("Use light theme", true);
  themeToggle.dataset.themeToggle = "";
  debugControls.append(editorToggle, themeToggle);
  const compilerLink = document.createElement("a");
  compilerLink.className = "codeblocks-compiler-link";
  compilerLink.target = "_blank";
  compilerLink.rel = "noopener";
  compilerLink.append("View on Compiler Explorer", externalLinkIcon());
  toolbar.append(runButton, debugControls, compilerLink);

  const outputDrawer = document.createElement("section");
  outputDrawer.className = "codeblocks-output";
  outputDrawer.dataset.outputDrawer = "";
  outputDrawer.hidden = true;
  outputDrawer.setAttribute("aria-live", "polite");
  const outputHeader = document.createElement("header");
  outputHeader.textContent = "Output";
  const output = document.createElement("pre");
  output.dataset.output = "";
  outputDrawer.append(outputHeader, output);

  root.classList.add("codeblocks-root");
  root.replaceChildren(
    ...(tabs.length > 1 ? [tabBar] : []),
    editorShell,
    toolbar,
    outputDrawer,
  );

  return {
    tabButtons,
    editorShell,
    fallbackHost,
    monacoHost,
    runButton,
    editorToggle,
    themeToggle,
    compilerLink,
    outputDrawer,
    output,
  };
}

function button(label: string, secondary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (secondary) element.className = "codeblocks-secondary";
  return element;
}

function externalLinkIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  return svg;
}
