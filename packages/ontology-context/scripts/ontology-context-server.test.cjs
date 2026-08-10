const assert = require("node:assert/strict");
const { once } = require("node:events");

async function main() {
  const { createSnapshotServer } = require("./ontology-context-server.cjs");
  const server = createSnapshotServer({ maxRequestsPerMinute: 10 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ontology/metadata`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, 1);
    assert.match(body.requestId, /^req_[0-9a-f-]+$/);
    assert.equal(body.authority.kind, "project_snapshot");
    assert.equal(body.data.dataset.id, "deepseek");
    console.log(JSON.stringify({ valid: true, host: address.address, status: response.status }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
