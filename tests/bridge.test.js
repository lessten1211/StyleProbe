import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createRelay } from "../bridge/relay.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const token = "test-pairing-token-at-least-24-chars";
const origin = "chrome-extension://" + "a".repeat(32);
async function pair(port, value = token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/probe`, { origin });
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "hello", token: value }));
  return ws;
}
test("relay authentication, result routing, timeout and disconnect", async () => {
  const relay = await createRelay({ port: 0, token, timeout: 80 });
  try {
    await assert.rejects(relay.call("inspect", {}), /not connected/);
    const invalid = await pair(relay.port, "invalid");
    assert.equal((await once(invalid, "close"))[0], 1008);
    const ws = await pair(relay.port);
    await once(ws, "message");
    const request = once(ws, "message");
    const result = relay.call("selected", { tabId: 4 });
    const msg = JSON.parse((await request)[0]);
    assert.equal(msg.args.tabId, 4);
    ws.send(
      JSON.stringify({ id: msg.id, ok: true, result: { element: null } }),
    );
    assert.deepEqual(await result, { element: null });
    await assert.rejects(relay.call("inspect", {}), /timed out/);
    const interrupted = relay.call("inspect", {});
    ws.close();
    await assert.rejects(interrupted, /disconnected/);
  } finally {
    await relay.close();
  }
});
test("MCP SDK client initializes, lists tools, validates arguments and calls through browser relay", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bridge/server.js"],
    env: { ...process.env, STYLEPROBE_TOKEN: token, STYLEPROBE_PORT: "19829" },
    stderr: "pipe",
  });
  const client = new Client({ name: "styleprobe-test", version: "1.0.0" });
  let ws;
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.ok(list.tools.some((t) => t.name === "preview"));
    assert.equal(
      (await client.callTool({ name: "inspect", arguments: {} })).isError,
      true,
    );
    ws = await pair(19829);
    await once(ws, "message");
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      ws.send(JSON.stringify({ id: msg.id, ok: true, result: [{ tabId: 7 }] }));
    });
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    assert.deepEqual(JSON.parse(result.content[0].text), [{ tabId: 7 }]);
  } finally {
    ws?.close();
    await client.close();
  }
});
