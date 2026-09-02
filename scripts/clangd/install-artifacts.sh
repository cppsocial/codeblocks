#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 PATH_TO_ARTIFACT_DIRECTORY_OR_TAR_GZ" >&2
  exit 2
fi

source_path=$(realpath "$1")
temporary_dir=""

if [[ -d "$source_path" ]]; then
  artifact_dir="$source_path"
else
  temporary_dir=$(mktemp -d)
  trap 'rm -rf "$temporary_dir"' EXIT
  tar -xzf "$source_path" -C "$temporary_dir"
  artifact_dir="$temporary_dir"
fi

clangd_js=$(find "$artifact_dir" -type f -name clangd.js -print -quit)
clangd_wasm=$(find "$artifact_dir" -type f -name clangd.wasm -print -quit)
if [[ -z "$clangd_js" || -z "$clangd_wasm" ]]; then
  echo "The artifact set must contain clangd.js and clangd.wasm." >&2
  exit 1
fi

mkdir -p "$clangd_wasm_dir"
artifact_root=$(dirname "$clangd_js")
# Copy the complete generated set, including pthread/data files whose names may
# differ between Emscripten releases.
find "$artifact_root" -maxdepth 1 -type f ! -name '.*' -exec cp -p {} "$clangd_wasm_dir/" \;
echo "Installed clangd artifacts in $clangd_wasm_dir"
