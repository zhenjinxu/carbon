import { resolveLanguage } from "@carbon/locale";
import type { Messages } from "@lingui/core";

const catalogLoaders = import.meta.glob(
  "../../../../packages/locale/locales/*/erp.mjs",
  {
    import: "messages"
  }
) as Record<string, () => Promise<Messages>>;

export async function loadLinguiCatalogForRequest(
  _request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const catalogPath = `../../../../packages/locale/locales/${language}/erp.mjs`;
  const load = catalogLoaders[catalogPath];
  if (!load) return {} as Record<string, string>;
  return (await load()) as Record<string, string>;
}

/**
 * Translate a Lingui message ID using the catalog for the given locale.
 * Falls back to the messageId itself if no translation is found.
 */
export async function translateMessageId(
  messageId: string,
  locale: string | null | undefined
): Promise<string> {
  const language = resolveLanguage(locale);
  const catalogPath = `../../../../packages/locale/locales/${language}/erp.mjs`;
  const load = catalogLoaders[catalogPath];
  if (!load) return messageId;
  const messages = await load();
  const translated = messages[messageId];
  if (!translated) return messageId;
  // Compiled messages can be a string or an array (for interpolated messages)
  if (typeof translated === "string") return translated;
  if (Array.isArray(translated)) {
    return translated
      .map((part) => (typeof part === "string" ? part : ""))
      .join("");
  }
  return messageId;
}
