#!/usr/bin/env bash
set -euo pipefail

workspace_dir=$(cd "$(dirname "$0")/.." && pwd)
runtime_dir="$workspace_dir/dist"
archive="$workspace_dir/clangd-browser-runtime.tar.gz"

for required in codeblocks.js codeblocks-module.js codeblocks.css editor.js fallback.js ansi.js grammars/c.js grammars/cpp.js wasm/clangd.js wasm/clangd.wasm; do
  if [[ ! -f "$runtime_dir/$required" ]]; then
    echo "Missing dist/$required; install the prebuilt clangd artifacts before packaging." >&2
    exit 1
  fi
done

tar -czf "$archive" -C "$runtime_dir" .
echo "Created $archive"
