export interface SourceRange {
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface ParsedRunline {
  source: string;
  compiler?: string;
  compilerArgs?: string;
}

export function parseHighlightedLines(
  value: string | number[] | undefined,
): number[] {
  if (Array.isArray(value)) {
    return [
      ...new Set(value.filter((line) => Number.isInteger(line) && line > 0)),
    ];
  }
  if (!value?.trim()) return [];
  const lines = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match)
      throw new SyntaxError(`Invalid highlighted line range “${part}”`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    for (
      let line = Math.min(start, end);
      line <= Math.max(start, end);
      line++
    ) {
      if (line > 0) lines.add(line);
    }
  }
  return [...lines];
}

export function parseSourceRange(
  value: string | null,
): SourceRange | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/);
  if (!match) throw new SyntaxError(`Invalid source range “${value}”`);
  return {
    startLine: Number(match[1]),
    ...(match[2] && { startColumn: Number(match[2]) }),
    endLine: Number(match[3] ?? match[1]),
    ...(match[4] && { endColumn: Number(match[4]) }),
  };
}

export function selectSource(source: string, range?: SourceRange): string {
  if (!range) return source;
  const lines = source.split("\n");
  const start = Math.max(0, (range.startLine ?? 1) - 1);
  const end = Math.min(
    lines.length,
    range.endLine ?? range.startLine ?? lines.length,
  );
  const selected = lines.slice(start, end);
  if (!selected.length) return "";
  if (range.startColumn) selected[0] = selected[0].slice(range.startColumn - 1);
  if (range.endColumn) {
    const last = selected.length - 1;
    const offset = selected.length === 1 ? (range.startColumn ?? 1) - 1 : 0;
    selected[last] = selected[last].slice(
      0,
      Math.max(0, range.endColumn - 1 - offset),
    );
  }
  return selected.join("\n");
}

export function parseRunline(source: string): ParsedRunline {
  const newline = source.indexOf("\n");
  const first = newline < 0 ? source : source.slice(0, newline);
  const match = first.match(/^\s*(?:\/\/|#(?=\s))\s*([^\s]+)(?:\s+(.*))?\s*$/);
  if (!match) return { source };
  const compilerArgs = match[2]?.trim() ?? "";
  const looksLikeCompiler =
    /\d|trunk|snapshot|^[a-z+_-]*clang|^g\+\+/i.test(match[1]) &&
    (!compilerArgs || compilerArgs.startsWith("-"));
  if (!looksLikeCompiler) return { source };
  return {
    source: newline < 0 ? "" : source.slice(newline + 1),
    compiler: match[1],
    compilerArgs,
  };
}

export async function fetchSource(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Unable to load source ${url} (${response.status})`);
  return response.text();
}

export function appendTranslationUnits(
  options: string,
  filenames: string[],
): string {
  const units = filenames.filter((filename) =>
    /\.(?:c|cc|cpp|cxx)$/i.test(filename),
  );
  const additions = units.filter((filename) => !options.includes(filename));
  return [options.trim(), ...additions.map(quoteCompilerArgument)]
    .filter(Boolean)
    .join(" ");
}

function quoteCompilerArgument(value: string): string {
  return /^[a-zA-Z0-9_./+-]+$/.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
