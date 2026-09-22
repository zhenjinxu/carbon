# Generate an AI Routing Draft

Last tested: 2026-08-17
Route: `/x/part/<itemId>/make/<makeMethodId>`

## Prerequisites

- Log in to the local ERP with `DEV_BYPASS_EMAIL`.
- The company has non-retired AI routing samples with operation snapshots.
- Use an existing Part make method with formal operations so draft isolation can
  be checked.

## Steps

### 1. Navigate

- Open `/x/part/<itemId>/make/<makeMethodId>`.
- Expected: the bill of process loads and the AI routing assistant panel is
  visible.

### 2. Generate a Draft

- Click **Generate draft** once.
- Wait for the new draft identifier, reference samples, and suggested operations
  to appear.
- Do not click **Accept** or **Reject** during this smoke test. Those actions
  create training feedback and change the draft state.

### 3. Verify the Result

- The new draft remains in `Draft` status.
- At least one reference sample and one suggested operation are shown.
- For the 2026-08-17 fixture, the result showed 5 references and 4 suggested
  operations.
- Confirm in the database that the draft count increased by one while feedback
  count and the formal `methodOperation` count did not change.

## Safety Boundary

- Generating a draft must never insert, update, reorder, or delete formal
  `makeMethod` or `methodOperation` records.
- Acceptance is feedback only; publishing a draft into a formal routing is a
  separate, currently unimplemented workflow.

## Common Failures

- No references: verify that the company has `Approved` or `Candidate` samples
  with non-empty operation snapshots.
- Login shows `Email is required`: quote the browser element reference in
  PowerShell, for example `'@e3'`, so `@` is not interpreted by the shell.
