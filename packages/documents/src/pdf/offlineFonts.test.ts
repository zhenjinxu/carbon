import fs from "node:fs";
import path from "node:path";
import { Text, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_SETTINGS } from "../template";
import Template from "./components/Template";

describe("offline PDF fonts", () => {
  it("does not register runtime CDN fonts from the shared template", () => {
    const templateSource = fs.readFileSync(
      path.resolve(__dirname, "components/Template.tsx"),
      "utf8"
    );

    expect(templateSource).not.toContain("fonts.gstatic.com");
    expect(DEFAULT_DOCUMENT_SETTINGS.fontFamily).toBe("Helvetica");
  });

  it("renders legacy Inter templates through the built-in fallback", async () => {
    const pdf = await renderToBuffer(
      createElement(
        Template,
        {
          title: "Offline PDF",
          meta: {},
          fontFamily: "Inter",
          showFooter: false
        },
        createElement(Text, null, "Offline PDF")
      ) as never
    );

    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
