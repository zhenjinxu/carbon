import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function env(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function endpointFromBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/responses`;
  return `${trimmed}/v1/responses`;
}

function mediaTypeForPath(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    default:
      throw new Error(`Unsupported image extension for preflight image: ${path}`);
  }
}

function dataUrlFromImagePath(path: string) {
  const stat = statSync(path);
  if (stat.size > 8 * 1024 * 1024) {
    throw new Error("Preflight image must be <= 8 MiB");
  }

  return `data:${mediaTypeForPath(path)};base64,${readFileSync(path).toString("base64")}`;
}

function findCodexInstructionInjection(
  value: unknown,
  path: string[] = []
): { path: string; pattern: string } | null {
  if (typeof value === "string") {
    const joinedPath = path.join(".").toLowerCase();
    const isInstructionLike =
      joinedPath.includes("instruction") ||
      joinedPath.includes("metadata") ||
      joinedPath.includes("system") ||
      joinedPath.includes("developer");

    const patterns = [
      "You are Codex",
      "Codex, a coding agent",
      "ChatGPT Excel Plugin",
      "spreadsheet agent",
      "AGENTS.md",
      "Desired oververbosity"
    ];
    const matchedPattern = patterns.find((pattern) =>
      value.toLowerCase().includes(pattern.toLowerCase())
    );

    return isInstructionLike && matchedPattern
      ? { path: path.join("."), pattern: matchedPattern }
      : null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCodexInstructionInjection(value[index], [
        ...path,
        String(index)
      ]);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findCodexInstructionInjection(child, [...path, key]);
      if (found) return found;
    }
  }

  return null;
}

function collectResponseText(value: unknown): string[] {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const object = node as Record<string, unknown>;
    if (
      (object.type === "output_text" || object.type === "text") &&
      typeof object.text === "string"
    ) {
      texts.push(object.text);
    }
    Object.values(object).forEach(visit);
  };

  visit(value);
  return texts;
}

async function main() {
  const apiKey = env("AI_ROUTING_PREFLIGHT_API_KEY") ?? env("OPENAI_API_KEY");
  const model = env("AI_ROUTING_PREFLIGHT_MODEL") ?? env("AI_ROUTING_DRAWING_MODEL_NAME");
  const baseUrl = env("AI_ROUTING_PREFLIGHT_BASE_URL") ?? env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const imagePath = env("AI_ROUTING_PREFLIGHT_IMAGE_PATH");
  const endpoint = endpointFromBaseUrl(baseUrl);

  if (!apiKey) throw new Error("OPENAI_API_KEY is required for endpoint preflight");
  if (!model) throw new Error("AI_ROUTING_PREFLIGHT_MODEL or AI_ROUTING_DRAWING_MODEL_NAME is required");

  const imageDataUrl = imagePath
    ? dataUrlFromImagePath(imagePath)
    : `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

  const controller = new AbortController();
  const timeoutMs = Number(env("AI_ROUTING_PREFLIGHT_TIMEOUT_MS") ?? 60_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const started = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Return exactly OK." },
              { type: "input_image", image_url: imageDataUrl }
            ]
          }
        ]
      }),
      signal: controller.signal
    });
    const elapsedMs = Date.now() - started;
    const bodyText = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    const bodyObject = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const errorObject =
      bodyObject.error && typeof bodyObject.error === "object"
        ? (bodyObject.error as Record<string, unknown>)
        : null;
    const injection = findCodexInstructionInjection(body);
    const outputText = collectResponseText(body).join(" ").trim();
    const responseStatus =
      typeof bodyObject.status === "string" ? bodyObject.status : null;

    const summary = {
      endpoint,
      model,
      httpStatus: response.status,
      responseStatus,
      elapsedMs,
      usedFallbackTinyImage: !imagePath,
      outputTextSample: outputText.slice(0, 120),
      errorType: typeof errorObject?.type === "string" ? errorObject.type : null,
      errorCode: typeof errorObject?.code === "string" ? errorObject.code : null,
      errorMessage:
        typeof errorObject?.message === "string"
          ? errorObject.message.slice(0, 240)
          : null,
      codexMetadataInjectionDetected: Boolean(injection),
      codexMetadataInjectionPath: injection?.path ?? null,
      codexMetadataInjectionPattern: injection?.pattern ?? null,
      passed:
        response.ok &&
        responseStatus === "completed" &&
        outputText === "OK" &&
        !injection
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.passed) {
      process.exitCode = injection ? 3 : response.ok ? 2 : 1;
    }
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        passed: false,
        transportError: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
