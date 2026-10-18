# StyleProbe Agent Probe — implementation plan

## Product contract

Turn a selected element into an evidence-backed task for a coding agent. The extension observes and changes the live DOM; the connected agent owns repository discovery and source edits. Do not claim computed CSS identifies a source file. Explicit `data-source-file` / `data-source-line` annotations may supply source hints.

Five workflows must ship:

1. Point-and-fix: select, describe, inspect surrounding layout, preview reversible CSS, then verify the agent's source change.
2. Design acceptance: accept JSON style/geometry/spacing expectations with tolerances, return observed values and pass/fail; capture referenceable screenshots for visual comparisons by the agent.
3. Diagnosis: report overflow, clipping ancestors, stacking context and center-point hit-testing with evidence, not unsupported root-cause claims.
4. Component extraction: bounded DOM subtree, scoped computed CSS, asset inventory and source hints, downloadable as an inert HTML/CSS starting point. Do not claim recovery of framework logic.
5. Action verification: bounded click/fill/scroll actions, before/after snapshots, explicit postconditions and timeout results. An action being dispatched is not evidence of success.

## Architecture

- `probe.js`: dependency-free page engine, document-scoped element references, bounded context, snapshots, diagnostics, transactions, extraction, assertions/actions.
- `content_script.js`: existing picking/highlight UI, selection routed to probe engine.
- `service_worker.js`: explicit tab routing, per-tab selection state, screenshot capture, authenticated loopback WebSocket connection.
- `panel.*`: selection, intent/context export, previews/undo, diagnostics, design expectations, extraction, snapshots/actions, connection settings.
- `bridge/`: Node MCP stdio server using the official SDK; loopback WebSocket relays named tools to the extension. Explicit `tabId` required for page tools. Token pairing, request timeout, reconnect, JSON output limits. No arbitrary script evaluation tool.

Page text and attributes are untrusted evidence. Tool results identify that boundary. Password/input values are excluded from ordinary inspection. Capturing a screenshot is explicit and limited to the active tab; report viewport coordinates and crop bounds.

## Stages and push gates

| Stage | Deliverable | Verification |
| --- | --- | --- |
| 0 | This design and acceptance plan | Repository and scope checked; commit/push |
| 1 | Probe engine and corrected extension foundation | Browser tests for references, context, measurements, exact undo, isolation; commit/push |
| 2 | Authenticated local bridge and MCP tools | SDK client round-trip, authentication, disconnect/timeout tests; commit/push |
| 3 | Five workflows exposed in panel and Agent tools | Browser tests covering each workflow, downloadable artifacts and failed assertions; commit/push |
| 4 | End-to-end extension integration, docs, regression fixes | Real loaded extension + MCP bridge, panel visual check, clean install/check suite; commit/push |

Push every completed stage to `codex/agent-probe` in `lessten1211/StyleProbe`. Keep stage evidence in `docs/progress.md`. No merge into main is implied.

## Acceptance scenarios

- Pick a card, export task context containing intent, target, parent/sibling layout, viewport, URL and optional source hint.
- Apply two previews to a property with an existing inline `!important`; undo exactly; new source navigation invalidates old refs.
- Switch tabs without carrying selection or changing the wrong page.
- Given style, rect and gap expectations, correctly report both passing and failing checks with observed values.
- Diagnose an overflowing child and a covered button using actual browser geometry/hit tests.
- Extract a card with text/images; remove executable nodes/event attributes and form values; exported standalone preview renders with bounded output.
- Click/fill/scroll, await explicit postconditions, distinguish successful state change from timeout and stale target.
- Through a real MCP client, list tabs, inspect selected target, capture region, preview/undo, diagnose, extract, assert and act; unauthorized sockets and disconnected browsers fail clearly.

## Initial limits

Desktop Chrome 116+, top-frame light DOM. Closed Shadow DOM, iframe interiors and trusted native pointer events are not implemented. Synthetic DOM actions may be rejected by sites; verify conditions rather than claiming universal automation. Screenshot captures can contain page content. Source mapping is explicit hints plus the coding agent's own search. Visual image comparison belongs to the connected multimodal agent; deterministic acceptance checks structured expectations. Extracted components are static starting points, not recovered React/Vue components.
