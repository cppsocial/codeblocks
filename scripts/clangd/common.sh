#!/usr/bin/env bash

clangd_script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
clangd_project_root=$(cd "$clangd_script_dir/../.." && pwd)
clangd_wasm_dir="$clangd_project_root/public/wasm"

require_clangd_artifacts() {
  local artifact
  for artifact in clangd.js clangd.wasm; do
    if [[ ! -s "$clangd_wasm_dir/$artifact" ]]; then
      echo "Missing or empty artifact: public/wasm/$artifact" >&2
      return 1
    fi
  done
}
