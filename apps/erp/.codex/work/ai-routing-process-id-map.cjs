const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

function loadEnvFile(path, override = false) {
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  const root = resolve(__dirname, "../../../..");
  loadEnvFile(resolve(root, ".env"));
  loadEnvFile(resolve(root, ".env.local"), true);
  const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
  const { createClient } = await import(
    pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href
  );
  const carbon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const ids = [
    "wodiprocess_74cece1f3a50817257f1e9dc",
    "u8proc_f6e011e7882189b9fc05a4b2",
    "wodiprocess_48b14696e7820288f3d239a2",
    "u8proc_4b1d56bd2a2820b629040581",
    "wodiprocess_8dcc004ef7392f8c20dfff0d",
    "u8proc_b47b49251b71b7cdf6f2601c"
  ];
  const { data, error } = await carbon
    .from("process")
    .select("id,name,companyId")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  console.log(JSON.stringify(ids.map((id) => byId.get(id) ?? { id, missing: true }), null, 2));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
