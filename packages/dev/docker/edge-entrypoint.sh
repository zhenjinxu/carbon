#!/bin/sh
# Inject dev-sidecar CA cert into system trust store before starting edge-runtime.
# This is needed because the Deno npm resolver in user workers doesn't honour
# the --cert flag; it only respects DENO_TLS_CA_STORE=system when the cert is
# in the OS trust store.

if [ -f /etc/ssl/certs/dev-sidecar-ca.crt ]; then
  cp /etc/ssl/certs/dev-sidecar-ca.crt /usr/local/share/ca-certificates/dev-sidecar-ca.crt 2>/dev/null
  update-ca-certificates --fresh >/dev/null 2>&1
fi

exec edge-runtime "$@"
