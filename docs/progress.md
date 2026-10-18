# Delivery log

## Stage 0 — design

- Read current main (`5af811e`), verified repository push access.
- Defined all five workflows, implementation boundaries, architecture and stage acceptance gates in `agent-probe-plan.md`.
- Implementation proceeds on `codex/agent-probe`.

## Stage 1 — runtime foundation

- Added document-scoped refs with stale/ambiguous target errors, bounded context, source annotations, geometry and snapshot diffs.
- Added validated CSS previews and LIFO undo preserving the exact original style attribute; conflicts reject destructive restoration.
- Added explicit-tab routing and per-tab session selection storage, corrected background-color reads and kept media selectable.
- Verified syntax checks and 5 real Chrome browser tests: context, spacing, redaction, stale refs, exact undo/conflicts, diffs and cross-document isolation.
- Full loaded-extension routing and panel tests remain Stage 4 gates.

## Stage 2 — Agent connection

- Added official MCP SDK stdio server with JSON Schema validation, tool discovery and PNG image responses.
- Added token-authenticated loopback WebSocket relay, bounded pending requests/payloads, timeout and disconnect errors.
- Extension supports explicit pairing/disconnect, reconnect alarms, heartbeat and active-tab viewport/element capture.
- Verified 2 Node integration tests using the actual MCP SDK client and WebSocket protocol; syntax checks pass.
- Browser-side pairing UI and real loaded-extension calls are verified in subsequent stages.

## Stage 3 — five workflows

- Rebuilt the side panel around task capture, design assertions, diagnosis/measurement, static extraction and action verification.
- Added five MCP tools: task, assert, diagnose, extract and act (15 tools total).
- Added inert standalone HTML export, source/asset evidence, screenshot display, JSON copy/download, local pairing UI and reversible style trials.
- Verified 10 real Chrome browser tests including all five workflows, exported component rendering, failed acceptance criteria, asynchronous action success/timeouts and invalid-input-before-mutation; both MCP tests and syntax checks pass.
- The upcoming final stage covers the actual packaged extension, panel interaction, bridge and screenshots together.

## Stage 4 — integrated delivery

- Loaded the real extension in isolated Chromium and called its browser implementation through the official MCP SDK client.
- Verified all 15 tools across protocol/browser tests, actual element picking, screenshot pixels without overlay tint, panel controls, HTML download, inactive-tab capture rejection, stale/cross-tab refs and snapshot comparison after refresh.
- Fixed legacy content-script message interception, ordinary HTTP UUID initialization, pairing independent of page access, and snapshot persistence across document refresh.
- Inspected the panel at 390px width; no horizontal overflow. UI harness uses the actual panel document in an extension popup with side-panel tab context adapted by the test (not browser chrome automation).
- Local gates: 13 browser tests, 2 Node integration tests, JavaScript syntax checks, Prettier formatting and git diff whitespace checks.
- Added clean-install instructions, full MCP schemas/examples, explicit capability boundaries and GitHub Actions checks.

## Completion evidence by workflow

| Requirement           | Implementation                            | Verification                                                                                                     |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Point-and-fix context | task + inspect + preview/undo             | intent/source/context test; exact undo/conflict test; MCP + panel preview tests                                  |
| Design acceptance     | assert + measure + capture                | passing/failing rules; exact gap; real PNG and untinted pixel check                                              |
| Page diagnosis        | diagnose                                  | clipped/overflowing/covered fixture; MCP and panel diagnostics                                                   |
| Component extraction  | extract + HTML download                   | script/value removal; exported rendering width; real panel download                                              |
| Action verification   | act + snapshot/diff                       | async click/fill success, timeout, invalid check before mutation, scroll, unverified result; refreshed-page diff |
| Agent connectivity    | stdio SDK + authenticated WS + SW routing | official client round-trip; auth/timeout/disconnect tests; real extension connection                             |
| Usable delivery       | docs + standalone extension files + CI    | syntax, formatting, browser/Node suite; stage commits pushed separately                                          |
