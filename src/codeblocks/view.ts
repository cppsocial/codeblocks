import type {
  CodeBlockEditableOption,
  CodeBlockOutputPosition,
  CodeBlockOutputView,
  CodeBlockUiOptions,
} from "./types";
import type { SourceTab } from "./element-options";

export interface CodeBlockViewOptions {
  outputPosition: CodeBlockOutputPosition;
  outputViews: CodeBlockOutputView[];
  editableOptions: boolean | CodeBlockEditableOption[];
  ui: Required<CodeBlockUiOptions>;
  activeTab: number;
  integratedActions: boolean;
}

export interface CodeBlockView {
  tabBar: HTMLDivElement;
  tabButtons: HTMLButtonElement[];
  workspace: HTMLDivElement;
  editorShell: HTMLDivElement;
  fallbackHost: HTMLDivElement;
  monacoHost: HTMLDivElement;
  settingsBar: HTMLDivElement;
  toolbar: HTMLDivElement;
  runButton: HTMLButtonElement;
  compilerLink: HTMLAnchorElement;
  info: HTMLDetailsElement;
  infoContent: HTMLDivElement;
  settings: HTMLElement;
  settingFields: Partial<
    Record<
      CodeBlockEditableOption,
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  >;
  outputDrawer: HTMLElement;
  outputHeader: HTMLElement;
  outputFooter: HTMLElement;
  outputTabs: Map<CodeBlockOutputView, HTMLButtonElement>;
  output: HTMLPreElement;
}

export function createCodeBlockView(
  root: HTMLElement,
  tabs: SourceTab[],
  options: CodeBlockViewOptions,
  selectTab: (index: number) => void,
): CodeBlockView {
  const tabBar = document.createElement("div");
  tabBar.className = "codeblocks-tabs";
  tabBar.hidden = !options.ui.tabs;
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Source files");
  const tabButtons = tabs.map((tab, index) => {
    const tabButton = button(tab.name, true);
    tabButton.className = "codeblocks-tab";
    tabButton.dataset.tabIndex = String(index);
    tabButton.hidden = tab.hidden ?? false;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute(
      "aria-selected",
      index === options.activeTab ? "true" : "false",
    );
    tabButton.tabIndex = index === options.activeTab ? 0 : -1;
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
  monacoHost.setAttribute("aria-label", "Source code editor");
  editorShell.append(fallbackHost, monacoHost);

  const outputDrawer = document.createElement("section");
  outputDrawer.className = "codeblocks-output";
  outputDrawer.dataset.syntaxTheme = "vscode-plus";
  outputDrawer.dataset.outputDrawer = "";
  outputDrawer.hidden = true;
  outputDrawer.setAttribute("aria-live", "polite");
  const outputHeader = document.createElement("header");
  const outputTabs = new Map<CodeBlockOutputView, HTMLButtonElement>();
  for (const view of options.outputViews) {
    const tab = button(outputViewLabel(view), true);
    tab.className = "codeblocks-output-tab codeblocks-secondary";
    tab.dataset.outputView = view;
    outputTabs.set(view, tab);
    outputHeader.append(tab);
  }
  const output = document.createElement("pre");
  output.dataset.output = "";
  const outputFooter = document.createElement("footer");
  outputFooter.className = "codeblocks-output-actions";
  outputDrawer.append(outputHeader, output, outputFooter);

  const workspace = document.createElement("div");
  workspace.className = "codeblocks-workspace";
  workspace.dataset.outputPosition = options.outputPosition;
  workspace.append(editorShell, outputDrawer);

  const toolbar = document.createElement("div");
  toolbar.className = "codeblocks-toolbar";
  toolbar.hidden = !options.ui.toolbar;
  const runButton = button("Run");
  runButton.dataset.run = "";
  runButton.hidden = !options.ui.runButton;

  const settings = createSettings(options.editableOptions);
  const settingsBar = document.createElement("div");
  settingsBar.className = "codeblocks-settings-bar";
  settingsBar.hidden = !options.ui.toolbar || settings.container.hidden;
  settingsBar.append(settings.container);
  const info = document.createElement("details");
  info.className = "codeblocks-info";
  info.hidden = !options.ui.info;
  const infoButton = document.createElement("summary");
  infoButton.setAttribute("aria-label", "About this code block");
  infoButton.title = "About this code block";
  infoButton.textContent = "i";
  const infoContent = document.createElement("div");
  infoContent.className = "codeblocks-popover";
  info.append(infoButton, infoContent);
  editorShell.append(info);

  const compilerLink = document.createElement("a");
  compilerLink.className = "codeblocks-compiler-link";
  compilerLink.hidden = !options.ui.compilerExplorerLink;
  compilerLink.target = "_blank";
  compilerLink.rel = "noopener";
  if (options.integratedActions) {
    runButton.className = "codeblocks-icon-action";
    runButton.replaceChildren(runIcon());
    runButton.setAttribute("aria-label", "Run again");
    runButton.title = "Run again";
    compilerLink.classList.add("codeblocks-icon-action");
    compilerLink.append(externalLinkIcon());
    compilerLink.setAttribute("aria-label", "Open in Compiler Explorer");
    compilerLink.title = "Open in Compiler Explorer";
    outputFooter.append(runButton, compilerLink);
  } else {
    compilerLink.append("View on Compiler Explorer", externalLinkIcon());
    toolbar.append(runButton, compilerLink);
  }
  toolbar.hidden =
    !options.ui.toolbar ||
    options.integratedActions ||
    (runButton.hidden && compilerLink.hidden);
  outputFooter.hidden =
    !options.ui.toolbar ||
    !options.integratedActions ||
    (runButton.hidden && compilerLink.hidden);

  root.classList.add("codeblocks-root");
  root.replaceChildren(
    ...(tabs.filter((tab) => !tab.hidden).length > 1 && options.ui.tabs
      ? [tabBar]
      : []),
    ...(!settingsBar.hidden ? [settingsBar] : []),
    workspace,
    toolbar,
  );

  return {
    tabBar,
    tabButtons,
    workspace,
    editorShell,
    fallbackHost,
    monacoHost,
    settingsBar,
    toolbar,
    runButton,
    compilerLink,
    info,
    infoContent,
    settings: settings.container,
    settingFields: settings.fields,
    outputDrawer,
    outputHeader,
    outputFooter,
    outputTabs,
    output,
  };
}

function createSettings(editable: boolean | CodeBlockEditableOption[]): {
  container: HTMLDivElement;
  fields: CodeBlockView["settingFields"];
} {
  const container = document.createElement("div");
  container.className = "codeblocks-settings";
  container.hidden =
    editable === false || (Array.isArray(editable) && !editable.length);
  const panel = document.createElement("div");
  panel.className = "codeblocks-settings-panel";
  const fields: CodeBlockView["settingFields"] = {};
  const enabled = (name: CodeBlockEditableOption) =>
    editable === true || (Array.isArray(editable) && editable.includes(name));

  for (const [name, label] of [
    ["language", "Language"],
    ["compiler", "Compiler"],
    ["compiler_args", "Compiler options"],
  ] as const) {
    if (!enabled(name)) continue;
    const control =
      name === "language" || name === "compiler"
        ? document.createElement("select")
        : document.createElement("input");
    control.name = name;
    fields[name] = control;
    panel.append(field(label, control, name));
  }

  if (enabled("run_args") || enabled("stdin")) {
    const execution = document.createElement("details");
    execution.className = "codeblocks-execution-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Execution";
    const executionPanel = document.createElement("div");
    executionPanel.className = "codeblocks-execution-panel";
    if (enabled("run_args")) {
      const input = document.createElement("input");
      input.name = "run_args";
      fields.run_args = input;
      executionPanel.append(field("Program arguments", input));
    }
    if (enabled("stdin")) {
      const input = document.createElement("textarea");
      input.name = "stdin";
      input.rows = 4;
      fields.stdin = input;
      executionPanel.append(field("Standard input", input));
    }
    execution.append(summary, executionPanel);
    panel.append(execution);
  }
  // Output tabs are the normal output selector. Keep the legacy field only
  // when a consumer explicitly asks for it rather than as part of `true`.
  if (Array.isArray(editable) && enabled("output")) {
    const select = selectField("output", ["execution", "compiler", "assembly"]);
    fields.output = select;
    panel.append(field("Output view", select));
  }
  container.append(panel);
  return { container, fields };
}

function field(
  label: string,
  control: HTMLElement,
  variant?: string,
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  if (variant) wrapper.dataset.field = variant;
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}

function selectField(name: string, values: string[]): HTMLSelectElement {
  const select = document.createElement("select");
  select.name = name;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = outputViewLabel(value as CodeBlockOutputView);
    select.append(option);
  }
  return select;
}

function outputViewLabel(view: CodeBlockOutputView): string {
  if (view.startsWith("tool:")) return view.slice(5);
  const labels: Record<string, string> = {
    execution: "Program output",
    compiler: "Compiler output",
    assembly: "Assembly",
  };
  return labels[view] ?? view;
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

function runIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 3.2v9.6L13 8 5 3.2Z");
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}
