#!/usr/bin/env bash
set -euo pipefail

workspace_dir=$(cd "$(dirname "$0")/.." && pwd)
wasm_dir="$workspace_dir/public/wasm"
release_id=${1:-$(date -u +%Y%m%d-%H%M%S)}

cd "$workspace_dir"

if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Release ID must contain only letters, numbers, dots, underscores, and hyphens." >&2
  exit 1
fi

for command_name in gh git sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

release_repository=${GH_REPO:-}
if [[ -z "$release_repository" ]]; then
  origin_url=$(git remote get-url origin 2>/dev/null || true)
  case "$origin_url" in
    git@github.com:*)
      release_repository=${origin_url#git@github.com:}
      ;;
    ssh://git@github.com/*)
      release_repository=${origin_url#ssh://git@github.com/}
      ;;
    https://github.com/*)
      release_repository=${origin_url#https://github.com/}
      ;;
  esac
  release_repository=${release_repository%.git}
fi

if [[ ! "$release_repository" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Could not determine the GitHub repository from the origin remote." >&2
  echo "Set GH_REPO to owner/repository and try again." >&2
  exit 1
fi

for artifact in clangd.js clangd.wasm; do
  if [[ ! -s "$wasm_dir/$artifact" ]]; then
    echo "Missing or empty artifact: public/wasm/$artifact" >&2
    exit 1
  fi
done

gh auth status >/dev/null

release_tag="clangd-wasm/$release_id"
if gh release view "$release_tag" --repo "$release_repository" >/dev/null 2>&1; then
  echo "Release already exists: $release_tag" >&2
  exit 1
fi

release_tmp=$(mktemp -d)
trap 'rm -rf "$release_tmp"' EXIT
checksum_file="$release_tmp/SHA256SUMS"
(
  cd "$wasm_dir"
  sha256sum clangd.js clangd.wasm
) > "$checksum_file"

commit_sha=$(git -C "$workspace_dir" rev-parse HEAD)
release_notes=$(printf '%s\n\n%s\n%s\n' \
  "Prebuilt clangd WebAssembly artifacts." \
  "Source commit: $commit_sha" \
  "Verify after download with: sha256sum -c SHA256SUMS")

echo "Creating GitHub Release $release_repository@$release_tag"
gh release create "$release_tag" \
  "$wasm_dir/clangd.js" \
  "$wasm_dir/clangd.wasm" \
  "$checksum_file" \
  --repo "$release_repository" \
  --target "$commit_sha" \
  --title "clangd wasm: $release_id" \
  --notes "$release_notes"

echo "Created $release_tag"
