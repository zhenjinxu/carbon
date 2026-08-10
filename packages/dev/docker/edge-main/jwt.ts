interface JwtHeader {
  alg?: string;
}

interface JwtPayload {
  exp?: number;
  nbf?: number;
}

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url value");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

export function parseDisabledFunctions(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

export async function verifyJwt(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (!secret) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson<JwtHeader>(encodedHeader);
    const payload = decodeJson<JwtPayload>(encodedPayload);
    if (header.alg !== "HS256") return false;
    if (payload.exp !== undefined) {
      if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
        return false;
      }
    }
    if (payload.nbf !== undefined) {
      if (typeof payload.nbf !== "number" || payload.nbf > nowSeconds) {
        return false;
      }
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
  } catch {
    return false;
  }
}
