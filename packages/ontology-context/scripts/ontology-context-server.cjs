const { register } = require("tsx/cjs/api");

register();

const { createOntologyContextServer } = require("../src/http.ts");
const { createOntologyService } = require("../src/service.ts");
const { loadSnapshotSource } = require("../src/snapshot-source.ts");

function createSnapshotServer(options) {
  const source = loadSnapshotSource();
  const service = createOntologyService(source.snapshot, source.authority);
  return createOntologyContextServer(service, options);
}

function startServer(port = Number(process.env.ONTOLOGY_CONTEXT_PORT ?? "0")) {
  const server = createSnapshotServer();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server_unavailable");
    console.log(JSON.stringify({ event: "ontology_context_listening", host: "127.0.0.1", port: address.port }));
  });
  return server;
}

if (require.main === module) {
  const server = startServer();
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

module.exports = { createSnapshotServer, startServer };
