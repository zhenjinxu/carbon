# AI Routing Source/PDF Review Packet — 2026-08-24

Scope: read-only reviewer packet for data-governance residuals after the 30-holdout Stage 4 audit.

## Gate Status

- Route generation change: blocked
- Training/Evaluation sample-role write: blocked until manual source review confirms route/evidence coherence
- Draft/materialization/formal method write: closed
- Work-center assignment: closed
- Required next gate: human source/PDF review plus coherent Training coverage planning

## Summary Table

| Part | PDF | Extraction | Prompt | Class / Stock | Target Tags | Process Hints | Truth Families | Generated Families | Training Coverage | Conflict Flags |
|---|---:|---|---|---|---|---|---|---|---:|---|
|1927930206 | 1 | aide_AuVwaULQPmqHBVeduqZKCx | ai-routing-drawing.prompt.v2 | machined / unknown | 板件, 孔, 螺纹, 台阶 | 激光切割, 攻丝, 氧化 | issue -> mill -> machining-center -> tap -> oxidation | empty | 0 | laser hint conflicts with non-laser truth route, oxidation truth route lacks coherent Training coverage, no coherent approved Training route covers truth families|
|192769010102 | 1 | aide_P24hvma6tfgWfMiMygxtig | ai-routing-drawing.prompt.v2 | unknown / unknown | 板件, 孔, 螺纹 | 激光切割, 攻丝, 氧化 | issue -> mill -> turn -> drill -> tap -> oxidation | empty | 0 | laser hint conflicts with non-laser truth route, sheet target tag conflicts with saw/turn truth route, oxidation truth route lacks coherent Training coverage, no coherent approved Training route covers truth families|
|192472540409 | 1 | aide_8rk3XwfKspF48nKAo3UUZs | ai-routing-drawing.prompt.v3 | unknown / unknown | 轴类, 孔, 螺纹, 台阶 | 攻丝, 车削, 氧化 | issue -> saw -> turn -> mill -> tap -> oxidation | empty | 0 | oxidation truth route lacks coherent Training coverage, no coherent approved Training route covers truth families|
|192759010202 | 1 | aide_UbjdKaBig5iVSi8kV5rARb | ai-routing-drawing.prompt.v3 | turned / bar | 板件, 孔, 螺纹, 台阶 | 激光切割, 攻丝 | issue -> saw -> turn -> mill -> drill -> tap | issue -> mill -> machining-center -> tap -> laser | 0 | laser hint conflicts with non-laser truth route, sheet target tag conflicts with saw/turn truth route, turned/bar extraction coexists with sheet target tag, no coherent approved Training route covers truth families|

## Coherent Training Coverage Plan

| Required Non-Issue Family Signature | Parts | Current Covering Training | Gate |
|---|---|---:|---|
| mill -> machining-center -> tap -> oxidation | 1927930206 | 0 | source/PDF review first; then add or identify coherent approved Training source outside Evaluation if route is confirmed |
| mill -> turn -> drill -> tap -> oxidation | 192769010102 | 0 | source/PDF review first; then add or identify coherent approved Training source outside Evaluation if route is confirmed |
| saw -> turn -> mill -> tap -> oxidation | 192472540409 | 0 | source/PDF review first; then add or identify coherent approved Training source outside Evaluation if route is confirmed |
| saw -> turn -> mill -> drill -> tap | 192759010202 | 0 | source/PDF review first; then add or identify coherent approved Training source outside Evaluation if route is confirmed |

## 1927930206

### Source Snapshot

- Active Part PDFs: 1
- PDF: `doc_XSVvDoSaTcUfh3ybGmsEJo` · 1927930206.pdf · path `d8s9bh4f8gm357312pbg/parts/wodiitem_a4d59c570e244d212b1cad7e/1927930206.pdf` · size 103
- Latest extraction: `aide_AuVwaULQPmqHBVeduqZKCx` · prompt `ai-routing-drawing.prompt.v2`
- Part class / stock form: `machined` / `unknown`
- Target material tags: `6061`
- Target feature tags: `板件, 孔, 螺纹, 台阶`
- Target process hints: `激光切割, 攻丝, 氧化`

### Route Conflict

- Locked truth route: `issue -> mill -> machining-center -> tap -> oxidation`
- Current generated route: `empty`
- Missing truth families: `mill, machining-center, tap, oxidation`
- Extra generated families: `none`
- Exact Training matches: 0
- Covering Training matches: 0

### Evidence Snippets

- dimension:Overall width — 126
- dimension:Overall height — 98
- dimension:Hole center spacing horizontal — 70
- dimension:Hole center spacing vertical — 70
- dimension:Thread-hole center spacing — 70.7
- dimension:Circular feature — Ø100
- dimension:Diameter A-A — Ø60 -0.01/-0.03
- dimension:Diameter A-A — Ø50
- dimension:Diameter A-A — Ø80 +0.035/0
- dimension:Section thickness — 11.5

### Manual Review Questions

- Confirm the active PDF is the same revision/source used for the locked Evaluation route.
- Confirm whether the locked Evaluation route is the correct manufacturing route for this PDF.
- Mark whether the drawing explicitly supports milling operations.
- Mark whether the drawing explicitly supports machining-center/CNC operations.
- Mark whether thread evidence is a visible tapped hole, not only a standalone thread spec.
- Mark whether oxidation/anodizing is specified on the drawing or route source.
- If laser is not in the truth route, decide whether the extraction laser hint is a false positive or the truth route is incomplete.
- If source review confirms the truth route, identify or create a non-Evaluation Training source with the same coherent non-issue family signature.

### Decision Before Any Write

- If PDF and locked route do not match: correct data/source first; do not create Training from this row.
- If PDF and locked route match: plan coherent Training coverage outside Evaluation; then rerun controlled holdout gates before route-generation changes.
- If extraction prompt version is v2: consider controlled v3 re-extraction after source review, then compare evidence before any routing change.

## 192769010102

### Source Snapshot

- Active Part PDFs: 1
- PDF: `doc_WJzgaXKNKxduY2Xtp5dPdG` · 192769010102.pdf · path `d8s9bh4f8gm357312pbg/parts/wodiitem_b9596db1aeabf6529e9241c1/192769010102.pdf` · size 91
- Latest extraction: `aide_P24hvma6tfgWfMiMygxtig` · prompt `ai-routing-drawing.prompt.v2`
- Part class / stock form: `unknown` / `unknown`
- Target material tags: `6061`
- Target feature tags: `板件, 孔, 螺纹`
- Target process hints: `激光切割, 攻丝, 氧化`

### Route Conflict

- Locked truth route: `issue -> mill -> turn -> drill -> tap -> oxidation`
- Current generated route: `empty`
- Missing truth families: `mill, turn, drill, tap, oxidation`
- Extra generated families: `none`
- Exact Training matches: 0
- Covering Training matches: 0

### Evidence Snippets

- dimension:Overall length — 126
- dimension:Overall width — 98
- dimension:Hole-center spacing — 70
- dimension:Hole-center spacing — 70
- dimension:Part thickness — 15
- dimension:Recess depth — 3.5
- dimension:Circular recess diameter — Ø60
- dimension:Central hole diameter — Ø50 ↧15
- dimension:Central hole depth — Ø50 ↧15
- dimension:Corner radius — 4-R10

### Manual Review Questions

- Confirm the active PDF is the same revision/source used for the locked Evaluation route.
- Confirm whether the locked Evaluation route is the correct manufacturing route for this PDF.
- Mark whether the drawing explicitly supports milling operations.
- Mark whether the drawing explicitly supports lathe/turning/shaft operations.
- Mark whether the drawing explicitly supports drilling separate from tapping/thread notes.
- Mark whether thread evidence is a visible tapped hole, not only a standalone thread spec.
- Mark whether oxidation/anodizing is specified on the drawing or route source.
- If laser is not in the truth route, decide whether the extraction laser hint is a false positive or the truth route is incomplete.
- If source review confirms the truth route, identify or create a non-Evaluation Training source with the same coherent non-issue family signature.

### Decision Before Any Write

- If PDF and locked route do not match: correct data/source first; do not create Training from this row.
- If PDF and locked route match: plan coherent Training coverage outside Evaluation; then rerun controlled holdout gates before route-generation changes.
- If extraction prompt version is v2: consider controlled v3 re-extraction after source review, then compare evidence before any routing change.

## 192472540409

### Source Snapshot

- Active Part PDFs: 1
- PDF: `doc_F74reWPB3JNwXRiLprhQgM` · 192472540409.pdf · path `d8s9bh4f8gm357312pbg/parts/wodiitem_b4c1f209502c82cd3bd79c08/192472540409.pdf` · size 107
- Latest extraction: `aide_8rk3XwfKspF48nKAo3UUZs` · prompt `ai-routing-drawing.prompt.v3`
- Part class / stock form: `unknown` / `unknown`
- Target material tags: `6061`
- Target feature tags: `轴类, 孔, 螺纹, 台阶`
- Target process hints: `攻丝, 车削, 氧化`

### Route Conflict

- Locked truth route: `issue -> saw -> turn -> mill -> tap -> oxidation`
- Current generated route: `empty`
- Missing truth families: `saw, turn, mill, tap, oxidation`
- Extra generated families: `none`
- Exact Training matches: 0
- Covering Training matches: 0

### Evidence Snippets

- dimension:外径 — ⌀60
- dimension:底座外径 — ⌀94
- dimension:内径 — ⌀52 +0.02/-0.02
- dimension:内孔台阶直径 — ⌀45 +0.02
- dimension:总高 — 45
- dimension:高度 — 30
- dimension:高度 — 15
- dimension:孔深 — 16
- dimension:孔深 — 22.25
- dimension:孔阵列半径 — R40

### Manual Review Questions

- Confirm the active PDF is the same revision/source used for the locked Evaluation route.
- Confirm whether the locked Evaluation route is the correct manufacturing route for this PDF.
- Mark whether the drawing explicitly supports saw/cut-off/bar/tube stock preparation.
- Mark whether the drawing explicitly supports lathe/turning/shaft operations.
- Mark whether the drawing explicitly supports milling operations.
- Mark whether thread evidence is a visible tapped hole, not only a standalone thread spec.
- Mark whether oxidation/anodizing is specified on the drawing or route source.
- If source review confirms the truth route, identify or create a non-Evaluation Training source with the same coherent non-issue family signature.

### Decision Before Any Write

- If PDF and locked route do not match: correct data/source first; do not create Training from this row.
- If PDF and locked route match: plan coherent Training coverage outside Evaluation; then rerun controlled holdout gates before route-generation changes.
- If extraction prompt version is v2: consider controlled v3 re-extraction after source review, then compare evidence before any routing change.

## 192759010202

### Source Snapshot

- Active Part PDFs: 1
- PDF: `doc_632r4phaWmyCHhABLRRTje` · 192759010202.pdf · path `d8s9bh4f8gm357312pbg/parts/wodiitem_67aa6030f75984cd62312899/192759010202.pdf` · size 99
- Latest extraction: `aide_UbjdKaBig5iVSi8kV5rARb` · prompt `ai-routing-drawing.prompt.v3`
- Part class / stock form: `turned` / `bar`
- Target material tags: `304`
- Target feature tags: `板件, 孔, 螺纹, 台阶`
- Target process hints: `激光切割, 攻丝`

### Route Conflict

- Locked truth route: `issue -> saw -> turn -> mill -> drill -> tap`
- Current generated route: `issue -> mill -> machining-center -> tap -> laser`
- Missing truth families: `saw, turn, drill`
- Extra generated families: `machining-center, laser`
- Exact Training matches: 0
- Covering Training matches: 0

### Evidence Snippets

- dimension:overall length — 166.5
- dimension:end feature length — 38
- dimension:hole spacing — 15
- dimension:hole center to end — 10
- dimension:hole center offset from centerline — 7.5
- dimension:main diameter — Ø15
- dimension:reduced diameter — Ø10
- dimension:step radial depth — 2.5
- dimension:left chamfer — C2
- dimension:right chamfer — C0.5

### Manual Review Questions

- Confirm the active PDF is the same revision/source used for the locked Evaluation route.
- Confirm whether the locked Evaluation route is the correct manufacturing route for this PDF.
- Mark whether the drawing explicitly supports saw/cut-off/bar/tube stock preparation.
- Mark whether the drawing explicitly supports lathe/turning/shaft operations.
- Mark whether the drawing explicitly supports drilling separate from tapping/thread notes.
- If laser is not in the truth route, decide whether the extraction laser hint is a false positive or the truth route is incomplete.
- Resolve turned/bar versus sheet tag conflict before using this row for Training or routing logic.
- If source review confirms the truth route, identify or create a non-Evaluation Training source with the same coherent non-issue family signature.

### Decision Before Any Write

- If PDF and locked route do not match: correct data/source first; do not create Training from this row.
- If PDF and locked route match: plan coherent Training coverage outside Evaluation; then rerun controlled holdout gates before route-generation changes.
- If extraction prompt version is v2: consider controlled v3 re-extraction after source review, then compare evidence before any routing change.
## Local PDF Copies

| Part | Document | Local Path | Bytes |
|---|---|---|---:|
| 1927930206 | 1927930206.pdf | `D:\Object\carbon\apps\erp\.codex\work\ai-routing-source-pdf-review-packet-20260824\1927930206-1927930206.pdf.pdf` | 105948 |
| 192769010102 | 192769010102.pdf | `D:\Object\carbon\apps\erp\.codex\work\ai-routing-source-pdf-review-packet-20260824\192769010102-192769010102.pdf.pdf` | 92932 |
| 192472540409 | 192472540409.pdf | `D:\Object\carbon\apps\erp\.codex\work\ai-routing-source-pdf-review-packet-20260824\192472540409-192472540409.pdf.pdf` | 109219 |
| 192759010202 | 192759010202.pdf | `D:\Object\carbon\apps\erp\.codex\work\ai-routing-source-pdf-review-packet-20260824\192759010202-192759010202.pdf.pdf` | 101549 |
