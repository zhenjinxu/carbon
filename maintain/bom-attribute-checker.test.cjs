const assert = require("node:assert/strict");
const checker = require("./bom-attribute-checker.cjs");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("normalizes Chinese and English BOM headers", () => {
  assert.equal(checker.normalizeHeader(" 子件编码 "), "子件编码");
  assert.equal(checker.normalizeHeader("Part No."), "partno");
  assert.equal(checker.normalizeHeader("ERP编码"), "erp编码");
});

test("detects the likely header row from sparse worksheet rows", () => {
  const rows = [
    ["1930010001 BOM"],
    [null, null, null],
    ["层级", "母件编码", "子件编码", "子件名称", "规格型号", "单位", "直接用量"],
    [1, "1930010001", "1001", "part", "M8", "PCS", 2]
  ];

  const detected = checker.detectHeaderRow(rows);

  assert.equal(detected.rowIndex, 2);
  assert.deepEqual(detected.headers.slice(0, 4), ["层级", "母件编码", "子件编码", "子件名称"]);
});

test("maps known BOM columns to Carbon tables and routes unknown attributes to customFields", () => {
  const result = checker.analyzeHeaders([
    "层级",
    "母件编码",
    "子件编码",
    "子件名称",
    "规格型号",
    "单位",
    "直接用量",
    "投料工序序号",
    "供应商",
    "表面颜色"
  ]);

  assert.equal(result.known.length, 9);
  assert.deepEqual(result.unknown.map((f) => f.excelHeader), ["表面颜色"]);
  assert.equal(result.unknown[0].recommendation.storage, "part.customFields.u8BomAttributes");
  assert.equal(
    result.known.find((f) => f.excelHeader === "子件编码").carbonField,
    "item.readableId"
  );
  assert.equal(
    result.known.find((f) => f.excelHeader === "直接用量").carbonField,
    "methodMaterial.quantity"
  );
});

test("builds PostgreSQL extension recommendations without reserved spare columns", () => {
  const result = checker.buildStorageRecommendation([
    { excelHeader: "表面颜色", samples: ["黑色", "本色"] },
    { excelHeader: "客户图号", samples: ["A-001"] }
  ]);

  assert.equal(result.primaryChoice, "jsonbCustomFields");
  assert.equal(result.avoidSpareColumns, true);
  assert.ok(result.sqlHints.some((line) => line.includes("GIN")));
});
