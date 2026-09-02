/**
 * Browsers reject a Worker whose initial script is on another origin.  A blob
 * URL belongs to the host document's origin and can import the runtime's real
 * module after the worker has started.
 */
export function createRemoteModuleWorker(
  moduleUrl: string,
  options: Omit<WorkerOptions, "type"> = {},
): { worker: Worker; disposeBootstrap: () => void } {
  const source = `import ${JSON.stringify(moduleUrl)};`;
  const bootstrapUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const worker = new Worker(bootstrapUrl, { ...options, type: "module" });

  return {
    worker,
    // The URL must remain alive while the worker and any delayed imports use it.
    // Callers revoke it when the owning editor is disposed.
    disposeBootstrap: () => URL.revokeObjectURL(bootstrapUrl),
  };
}

export function remoteModuleBootstrap(moduleUrl: string): Blob {
  return new Blob([`import ${JSON.stringify(moduleUrl)};`], {
    type: "text/javascript",
  });
}
