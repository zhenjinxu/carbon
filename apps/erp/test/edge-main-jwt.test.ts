import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseDisabledFunctions,
  verifyJwt,
} from "../../../packages/dev/docker/edge-main/jwt";

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload: Record<string, unknown>, secret: string) {
  const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

describe("self-hosted Edge Runtime JWT verification", () => {
  it("accepts a valid HS256 token", async () => {
    const secret = "production-secret";
    const token = sign(
      { role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 },
      secret
    );

    await expect(verifyJwt(token, secret)).resolves.toBe(true);
  });

  it("rejects tampered and expired tokens", async () => {
    const secret = "production-secret";
    const token = sign(
      { role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 },
      secret
    );
    const [header, , signature] = token.split(".");
    const tampered = `${header}.${encode({ role: "service_role" })}.${signature}`;
    const expired = sign(
      { role: "authenticated", exp: Math.floor(Date.now() / 1000) - 1 },
      secret
    );

    await expect(verifyJwt(tampered, secret)).resolves.toBe(false);
    await expect(verifyJwt(expired, secret)).resolves.toBe(false);
  });

  it("parses the explicit public-function allowlist", () => {
    expect(parseDisabledFunctions(" image-resizer,logo-resizer, ")).toEqual(
      new Set(["image-resizer", "logo-resizer"])
    );
  });
});
