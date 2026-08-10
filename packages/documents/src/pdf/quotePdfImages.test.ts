import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import QuotePDF from "./QuotePDF";
import { SAMPLE_QUOTE } from "./quote.samples";

describe("quote PDF images", () => {
  it.each([null, ""])(
    "renders when a configured thumbnail cannot be resolved (%j)",
    async (thumbnail) => {
      const pdf = await renderToBuffer(
        createElement(QuotePDF, {
          ...SAMPLE_QUOTE,
          thumbnails: { "line-1": thumbnail }
        }) as never
      );

      expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    }
  );
});
