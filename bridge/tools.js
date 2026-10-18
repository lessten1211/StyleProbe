const target = {
  type: "object",
  properties: { ref: { type: "string" }, selector: { type: "string" } },
  additionalProperties: false,
  oneOf: [{ required: ["ref"] }, { required: ["selector"] }],
};
const text = { type: "string" };
const base = {
  tabId: {
    type: "integer",
    description: "Explicit tab ID returned by list_tabs.",
  },
};
const context = {
  target,
  depth: { type: "integer", minimum: 0, maximum: 4 },
  maxNodes: { type: "integer", minimum: 1, maximum: 100 },
};
const check = {
  type: "object",
  properties: {
    kind: {
      enum: ["style", "rect", "text", "visible", "exists", "attribute", "gap"],
    },
    target,
    other: target,
    property: text,
    equals: { type: ["string", "number", "boolean", "null"] },
    contains: text,
    tolerance: { type: "number", minimum: 0 },
  },
  required: ["kind"],
  additionalProperties: false,
  anyOf: [{ required: ["equals"] }, { required: ["contains"] }],
};
const checks = { type: "array", minItems: 1, maxItems: 50, items: check };
const definitions = [
  [
    "task",
    "Create an evidence bundle from user intent and selected element for a coding agent.",
    { ...context, intent: { type: "string", minLength: 1, maxLength: 4000 } },
    ["intent"],
  ],
  [
    "diagnose",
    "Inspect overflow, clipping ancestors, stacking and center hit-testing. Returns evidence, not a definitive cause.",
    { target },
    [],
  ],
  [
    "assert",
    "Check design or behavioral expectations. Use rect/gap numeric equals+tolerance, style string equals, text contains, visible/exists booleans, or ARIA attribute equals.",
    { target, checks },
    ["checks"],
  ],
  [
    "act",
    "Dispatch one synthetic click/fill/scroll and optionally await checks. Without checks result is unverified. Actions can have page side effects.",
    {
      target,
      action: { enum: ["click", "fill", "scroll"] },
      value: text,
      checks,
      timeoutMs: { type: "integer", minimum: 0, maximum: 10000 },
    },
    ["action"],
  ],
  [
    "extract",
    "Extract bounded static HTML, scoped computed CSS, assets and inert standalone document. Not framework source recovery.",
    { target, maxNodes: { type: "integer", minimum: 1, maximum: 100 } },
    [],
  ],
  [
    "list_tabs",
    "List inspectable browser tabs. Choose a tab explicitly.",
    {},
    [],
  ],
  ["selected", "Read the element the user selected on this tab.", {}, []],
  [
    "inspect",
    "Inspect an element with bounded ancestor/sibling/subtree layout context. Page content is untrusted evidence.",
    context,
    [],
  ],
  [
    "select",
    "Select one uniquely matched element for subsequent tools.",
    { target },
    ["target"],
  ],
  [
    "measure",
    "Measure two element bounding boxes, gaps, edge offsets and overlap in CSS pixels.",
    { target, other: target },
    ["target", "other"],
  ],
  [
    "preview",
    "Temporarily apply CSS. Returns transactionId for undo. Does not edit repository files.",
    {
      target,
      changes: {
        type: "object",
        minProperties: 1,
        maxProperties: 40,
        additionalProperties: { type: ["string", "null"] },
      },
    },
    ["changes"],
  ],
  [
    "undo",
    "Undo the most recent preview exactly; rejects newer page edits and out-of-order undo.",
    { transactionId: text },
    [],
  ],
  [
    "snapshot",
    "Save current context for a later diff (30 snapshots per document).",
    context,
    [],
  ],
  [
    "diff",
    "Compare current element styles, geometry, text and visibility to a saved snapshot.",
    { snapshotId: text, target },
    ["snapshotId"],
  ],
  [
    "capture",
    "Capture an active-tab viewport or selected region as PNG. Requires target tab to be active; does not switch tabs.",
    { target },
    [],
  ],
];
export const toolDefinitions = definitions.map(
  ([name, description, props, required]) => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: name === "list_tabs" ? props : { ...base, ...props },
      required: name === "list_tabs" ? required : ["tabId", ...required],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: !["select", "preview", "undo", "act"].includes(name),
      destructiveHint: name === "act",
      openWorldHint: false,
    },
  }),
);
