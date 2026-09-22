import { describe, expect, it } from "vitest";

import {
  buildCsvDownloadContent,
  buildCsvExportRows,
  getVisibleCsvColumnIds,
  UTF8_BOM
} from "./csvExport";

describe("table CSV export", () => {
  it("expands a visible combined item column into part ID and name columns", () => {
    const rows = buildCsvExportRows(
      [
        {
          id: "wodiitem_edee0870cdbff0e343606172",
          readableIdWithRevision: "1919671001",
          name: "转轮盖板",
          createdAt: "2026-07-16T06:55:15.307595+00:00"
        }
      ],
      ["id", "createdAt"],
      {
        id: [
          { header: "零件ID", accessorKey: "readableIdWithRevision" },
          { header: "名称", accessorKey: "name" }
        ],
        createdAt: [{ header: "创建于", accessorKey: "createdAt" }]
      }
    );

    expect(rows).toEqual([
      {
        零件ID: "1919671001",
        名称: "转轮盖板",
        创建于: "2026-07-16T06:55:15.307595+00:00"
      }
    ]);
  });

  it("preserves numeric-looking identifier strings when opened in Excel", () => {
    const rows = buildCsvExportRows(
      [
        {
          readableIdWithRevision: "001234567890123456",
          name: "测试零件"
        }
      ],
      ["id"],
      {
        id: [
          {
            header: "零件ID",
            accessorKey: "readableIdWithRevision",
            preserveAsText: true
          }
        ]
      }
    );

    expect(rows).toEqual([
      {
        零件ID: '="001234567890123456"'
      }
    ]);
  });
  it("adds a UTF-8 BOM so Excel opens localized headers correctly", () => {
    const csv = buildCsvDownloadContent([
      {
        零件ID: "1919671001",
        名称: "转轮盖板"
      }
    ]);

    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain("零件ID,名称");
  });

  it("keeps exports scoped to visible columns in the current view order", () => {
    expect(
      getVisibleCsvColumnIds(
        ["createdAt", "id", "description"],
        { id: true, description: false },
        {
          id: [{ header: "零件ID", accessorKey: "readableIdWithRevision" }],
          createdAt: [{ header: "创建于", accessorKey: "createdAt" }],
          description: [{ header: "描述", accessorKey: "description" }]
        }
      )
    ).toEqual(["createdAt", "id"]);
  });
});
