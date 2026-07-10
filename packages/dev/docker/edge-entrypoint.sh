#!/bin/sh
# Inject dev-sidecar CA cert into system trust store before starting edge-runtime.
# This is needed because the Deno npm resolver in user workers doesn't honour
# the --cert flag; it only respects DENO_TLS_CA_STORE=system when the cert is
# in the OS trust store.
#
# Also pre-populates the Deno npm cache with packages that may be missing.
# Behind corporate proxies (dev-sidecar), the npm registry connection can hang
# indefinitely, so we ship known-missing packages in /home/deno/npm-preload/.

if [ -f /etc/ssl/certs/dev-sidecar-ca.crt ]; then
  cp /etc/ssl/certs/dev-sidecar-ca.crt /usr/local/share/ca-certificates/dev-sidecar-ca.crt 2>/dev/null
  update-ca-certificates --fresh >/dev/null 2>&1
fi

# Pre-load any npm packages that are missing from the Deno cache.
# Each subdirectory of /home/deno/npm-preload/ should be named
# <package-name>-<version> and contain the extracted npm package contents.
if [ -d /home/deno/npm-preload ]; then
  for pkg_dir in /home/deno/npm-preload/*/; do
    [ -d "$pkg_dir" ] || continue
    dir_name=$(basename "$pkg_dir")
    # Extract package name and version from directory name.
    # Format: <name>-<version> e.g. "encoding-0.1.13"
    # For scoped packages: @scope+name-version e.g. "@swc+helpers-0.5.23"
    case "$dir_name" in
      @*)
        # Scoped package: @scope+name-version
        scope_and_name=$(echo "$dir_name" | sed 's/-[0-9].*$//')
        version=$(echo "$dir_name" | sed "s/^${scope_and_name}-//")
        scope=$(echo "$scope_and_name" | cut -d+ -f1)
        name=$(echo "$scope_and_name" | cut -d+ -f2)
        cache_dir="/root/.cache/deno/npm/registry.npmjs.org/${scope}/${name}/${version}"
        ;;
      *)
        # Unscoped package: name-version
        name=$(echo "$dir_name" | sed 's/-[0-9].*$//')
        version=$(echo "$dir_name" | sed "s/^${name}-//")
        cache_dir="/root/.cache/deno/npm/registry.npmjs.org/${name}/${version}"
        ;;
    esac
    if [ ! -f "${cache_dir}/package.json" ]; then
      mkdir -p "$cache_dir"
      cp -r "$pkg_dir"/* "$cache_dir"/ 2>/dev/null
    fi
  done
fi

exec edge-runtime "$@"
