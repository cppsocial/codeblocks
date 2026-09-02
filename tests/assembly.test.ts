import { describe, expect, it } from "vitest";
import { tokenizeAssembly } from "../src/codeblocks/assembly";

describe("assembly highlighting", () => {
  it("recognizes labels, instructions, registers, numbers, and comments", () => {
    expect(
      tokenizeAssembly("square(int):").some((token) => token.kind === "label"),
    ).toBe(true);
    const tokens = tokenizeAssembly("  mov eax, 42 ; result");
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "mov", kind: "keyword" }),
        expect.objectContaining({ text: "eax", kind: "register" }),
        expect.objectContaining({ text: "42", kind: "number" }),
        expect.objectContaining({ text: "; result", kind: "comment" }),
      ]),
    );
  });
});
