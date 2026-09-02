export type AssemblyTokenKind =
  "plain" | "comment" | "keyword" | "number" | "register" | "label";

export interface AssemblyToken {
  text: string;
  kind: AssemblyTokenKind;
}

const TOKEN =
  /(;.*$|#.*$|\b(?:0x[\da-f]+|\d+)\b|%?\b(?:r(?:ax|bx|cx|dx|si|di|sp|bp|8|9|10|11|12|13|14|15)|e(?:ax|bx|cx|dx|si|di|sp|bp)|[abcd][lh]|[xyz]mm\d+|st\d*|rip|eip)\b|\b[A-Za-z_.$][\w.$]*:?)/gi;

export function tokenizeAssembly(line: string): AssemblyToken[] {
  const tokens: AssemblyToken[] = [];
  let offset = 0;
  let firstWord = true;
  const isLabelLine = line.trimEnd().endsWith(":");
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > offset)
      tokens.push({ text: line.slice(offset, index), kind: "plain" });
    const text = match[0];
    let kind: AssemblyTokenKind = "plain";
    if (text.startsWith(";") || text.startsWith("#")) kind = "comment";
    else if (/^(?:0x[\da-f]+|\d+)$/i.test(text)) kind = "number";
    else if (
      /^%?(?:r(?:ax|bx|cx|dx|si|di|sp|bp|8|9|10|11|12|13|14|15)|e(?:ax|bx|cx|dx|si|di|sp|bp)|[abcd][lh]|[xyz]mm\d+|st\d*|rip|eip)$/i.test(
        text,
      )
    )
      kind = "register";
    else if (text.endsWith(":") || (firstWord && isLabelLine)) kind = "label";
    else if (firstWord) kind = "keyword";
    tokens.push({ text, kind });
    if (kind !== "plain") firstWord = false;
    offset = index + text.length;
    if (kind === "comment") break;
  }
  if (offset < line.length)
    tokens.push({ text: line.slice(offset), kind: "plain" });
  return tokens;
}
