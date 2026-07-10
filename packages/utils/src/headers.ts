import * as cookie from "cookie";
import { parseAcceptLanguage } from "intl-parse-accept-language";

type OperatingSystemPlatform = "mac" | "windows";

/**
 * Build a Content-Disposition header value with proper non-ASCII filename encoding.
 * Uses RFC 5987 `filename*=UTF-8''...` for modern browsers, plus an ASCII fallback.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string
) {
  const ascii = filename.replace(/[^\x00-\x7F]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const getPreferenceHeaders = (request: Request) => {
  const acceptLanguage = request.headers.get("accept-language");
  const cookieHeader = request.headers.get("cookie");
  const localeCookie = cookieHeader
    ? cookie.parse(cookieHeader).locale
    : undefined;
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf
  });
  const [cookieLocale] = localeCookie
    ? Intl.DateTimeFormat.supportedLocalesOf([localeCookie])
    : [];

  // get whether it's a mac or pc from the headers
  const platform: OperatingSystemPlatform = request.headers
    .get("user-agent")
    ?.includes("Mac")
    ? "mac"
    : "windows";

  let locale = cookieLocale ?? locales?.[0] ?? "en-US";

  if (cookieLocale && !cookieLocale.includes("-") && locales?.length) {
    const regionalMatch = locales.find((l) =>
      l.toLowerCase().startsWith(cookieLocale.toLowerCase() + "-")
    );
    if (regionalMatch) locale = regionalMatch;
  }

  return {
    platform,
    locale
  };
};
