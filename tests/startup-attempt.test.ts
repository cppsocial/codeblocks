import { beforeEach, describe, expect, it } from "vitest";
import { beginStartupAttempt } from "../src/startup-attempt";

describe("startup attempt circuit breaker", () => {
  beforeEach(() => sessionStorage.clear());

  it("stops retrying after the configured number of interrupted attempts", () => {
    expect(beginStartupAttempt("clangd", 2).allowed).toBe(true);
    expect(beginStartupAttempt("clangd", 2).allowed).toBe(true);
    expect(beginStartupAttempt("clangd", 2).allowed).toBe(false);
  });

  it("clears the failure history after a successful startup", () => {
    const attempt = beginStartupAttempt("monaco", 1);
    attempt.succeeded();
    expect(beginStartupAttempt("monaco", 1).allowed).toBe(true);
  });
});
