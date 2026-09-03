export type StartupComponent = "monaco" | "clangd";

export interface StartupAttempt {
  allowed: boolean;
  succeeded(): void;
}

const prefix = "codeblocks.startup-attempts.";

/**
 * Keep a failed or interrupted startup from being repeated indefinitely. The
 * session store survives a reload (including a browser restoring a crashed
 * tab), but opening a new tab gives a recovered deployment another chance.
 */
export function beginStartupAttempt(
  component: StartupComponent,
  maximumAttempts: number,
): StartupAttempt {
  const key = `${prefix}${component}`;
  const storage = sessionStore();
  let attempts = 0;
  try {
    attempts = Number(storage?.getItem(key) ?? 0) || 0;
  } catch {
    // Treat inaccessible storage like an empty, non-persistent store.
  }
  if (attempts >= maximumAttempts) {
    return { allowed: false, succeeded() {} };
  }

  try {
    storage?.setItem(key, String(attempts + 1));
  } catch {
    // Startup should still be attempted when storage is unavailable.
  }
  return {
    allowed: true,
    succeeded() {
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing else is required when storage is unavailable.
      }
    },
  };
}

function sessionStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    // Storage can be unavailable in sandboxed or privacy-restricted frames.
    return undefined;
  }
}
