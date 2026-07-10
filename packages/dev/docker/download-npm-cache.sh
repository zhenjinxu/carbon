#!/usr/bin/env bash
set -euo pipefail

PRELOAD_DIR="D:/object/carbon/packages/dev/docker/npm-cache-preload"
mkdir -p "$PRELOAD_DIR"

# download_pkg <scope_or_empty> <name> <version>
# e.g. download_pkg "@supabase" "supabase-js" "2.33.1"
#      download_pkg "" "zod" "3.25.76"
download_pkg() {
  local scope="$1"
  local name="$2"
  local version="$3"

  # Determine directory name
  local dir_name
  if [ -n "$scope" ]; then
    dir_name="@${scope}+${name}-${version}"
  else
    dir_name="${name}-${version}"
  fi

  # Skip if already exists
  if [ -d "$PRELOAD_DIR/$dir_name" ]; then
    echo "SKIP (exists): $dir_name"
    return 0
  fi

  # Determine download URL
  local url
  if [ -n "$scope" ]; then
    url="https://registry.npmjs.org/@${scope}/${name}/-/${name}-${version}.tgz"
  else
    url="https://registry.npmjs.org/${name}/-/${name}-${version}.tgz"
  fi

  echo "DOWNLOAD: $dir_name from $url"

  # Create temp dir for extraction
  local tmp_dir
  tmp_dir=$(mktemp -d)

  # Download tarball
  local tgz_file="$tmp_dir/package.tgz"
  if ! curl -sS --connect-timeout 10 --max-time 60 -L -o "$tgz_file" "$url"; then
    echo "ERROR: Failed to download $dir_name"
    rm -rf "$tmp_dir"
    return 0  # continue on error
  fi

  # Check file is not empty or an error page
  if [ ! -s "$tgz_file" ]; then
    echo "ERROR: Empty download for $dir_name"
    rm -rf "$tmp_dir"
    return 0
  fi

  # Extract into target directory
  local target_dir="$PRELOAD_DIR/$dir_name"
  mkdir -p "$target_dir"
  if ! tar -xzf "$tgz_file" -C "$target_dir" --strip-components=1 2>/dev/null; then
    echo "ERROR: Failed to extract $dir_name"
    rm -rf "$tmp_dir" "$target_dir"
    return 0
  fi

  # Cleanup
  rm -rf "$tmp_dir"
  echo "OK: $dir_name"
}

echo "=== Starting npm cache preload ==="
echo ""

# Scoped packages: download_pkg "scope" "name" "version"
download_pkg "supabase" "supabase-js" "2.33.1"
download_pkg "supabase" "functions-js" "2.110.1"
download_pkg "supabase" "gotrue-js" "2.108.2"
download_pkg "supabase" "postgrest-js" "1.21.4"
download_pkg "supabase" "realtime-js" "2.110.1"
download_pkg "supabase" "storage-js" "2.110.1"
download_pkg "supabase" "node-fetch" "2.6.15"
download_pkg "supabase" "phoenix" "0.4.4"
download_pkg "ecies" "ciphers" "0.2.6"
download_pkg "noble" "ciphers" "1.3.0"
download_pkg "noble" "curves" "1.9.7"
download_pkg "noble" "hashes" "1.8.0"
download_pkg "internationalized" "date" "3.12.2"
download_pkg "swc" "helpers" "0.5.23"

# Unscoped packages: download_pkg "" "name" "version"
download_pkg "" "kysely" "0.26.3"
download_pkg "" "kysely-supabase" "0.2.1"
download_pkg "" "cross-fetch" "3.2.0"
download_pkg "" "node-fetch" "2.7.0"
download_pkg "" "whatwg-url" "5.0.0"
download_pkg "" "tr46" "0.0.3"
download_pkg "" "webidl-conversions" "3.0.1"
download_pkg "" "tslib" "2.8.1"
download_pkg "" "supabase" "2.109.1"
download_pkg "" "eciesjs" "0.5.0"
download_pkg "" "jose" "6.2.3"
download_pkg "" "iceberg-js" "0.8.1"
download_pkg "" "zod" "3.25.76"

echo ""
echo "=== Done! ==="
echo ""
echo "Contents of preload directory:"
ls "$PRELOAD_DIR"
