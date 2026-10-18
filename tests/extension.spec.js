import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = path.resolve(".");
const token = "extension-integration-test-pairing-token";
test("loaded extension, side panel, MCP and five workflows end to end", async () => {
  test.setTimeout(90000);
  const html = `<!doctype html><title>Probe integration</title><style>body{font:16px Arial;padding:30px}.row{display:flex;gap:20px}.card{width:240px;padding:20px;box-sizing:border-box;background:#e1eee2;border-radius:8px}button{padding:10px}</style><div class="row"><article class="card" id="card" data-source-file="src/Card.jsx"><h2>Agent Probe</h2><p>Inspect a real component.</p><button id="expand" aria-expanded="false">Expand</button></article><article class="card" id="second">Second card</article></div><input id="field"><p id="output"></p><script>document.querySelector('#expand').onclick=e=>e.target.setAttribute('aria-expanded','true');document.querySelector('#field').oninput=e=>document.querySelector('#output').textContent=e.target.value;</script>`;
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const client = new Client({ name: "extension-e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bridge/server.js"],
    env: { ...process.env, STYLEPROBE_TOKEN: token, STYLEPROBE_PORT: "19831" },
    stderr: "pipe",
  });
  let context;
  try {
    await client.connect(transport);
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      viewport: { width: 1000, height: 800 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const tabId = tabs.find((t) => t.url?.includes("127.0.0.1")).id;
    const panelEvent = context.waitForEvent("page");
    const window = await worker.evaluate(
      ({ extensionId }) =>
        chrome.windows.create({
          url: `chrome-extension://${extensionId}/panel.html`,
          type: "popup",
          width: 430,
          height: 900,
        }),
      { extensionId },
    );
    const panelPage = await panelEvent;
    await panelPage.waitForLoadState();
    await panelPage.setViewportSize({ width: 390, height: 850 });
    // Exercise the real panel document; emulate its side-panel tab context inside this popup harness.
    await panelPage.evaluate(
      ({ tabId, port }) => {
        chrome.tabs.query = async () => [
          { id: tabId, url: `http://127.0.0.1:${port}/` },
        ];
      },
      { tabId, port },
    );
    await panelPage.locator(".connection summary").click();
    await panelPage.locator("#port").fill("19831");
    await panelPage.locator("#token").fill(token);
    await panelPage.locator("#connect").click();
    await expect(panelPage.locator("#connectionState")).toHaveText("connected");
    async function tool(name, args = {}) {
      const result = await client.callTool({
        name,
        arguments: name === "list_tabs" ? {} : { tabId, ...args },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return JSON.parse(result.content[0].text);
    }
    expect((await tool("list_tabs")).some((t) => t.tabId === tabId)).toBe(true);
    const card = await tool("select", { target: { selector: "#card" } });
    expect((await tool("selected")).element.ref).toBe(card.ref);
    expect(
      (await tool("inspect", { target: { ref: card.ref } })).siblings[0].id,
    ).toBe("second");
    const task = await tool("task", { intent: "Make the cards align" });
    expect(task.context.element.id).toBe("card");
    const snapshot = await tool("snapshot");
    await tool("preview", { changes: { width: "280px" } });
    expect(
      (await tool("diff", { snapshotId: snapshot.snapshotId })).changed,
    ).toBe(true);
    await tool("undo");
    expect((await tool("inspect")).element.rect.width).toBe(240);
    expect(
      (
        await tool("assert", {
          checks: [
            { kind: "rect", property: "width", equals: 240, tolerance: 1 },
          ],
        })
      ).pass,
    ).toBe(true);
    expect(
      (
        await tool("measure", {
          target: { selector: "#card" },
          other: { selector: "#second" },
        })
      ).horizontalGap,
    ).toBe(20);
    expect((await tool("diagnose")).findings).toBeDefined();
    const extracted = await tool("extract");
    expect(extracted.document).toContain("Content-Security-Policy");
    const action = await tool("act", {
      target: { selector: "#expand" },
      action: "click",
      checks: [
        { kind: "attribute", property: "aria-expanded", equals: "true" },
      ],
    });
    expect(action.verified).toBe(true);
    expect(
      (
        await tool("act", {
          target: { selector: "#field" },
          action: "fill",
          value: "Observed",
          checks: [
            {
              target: { selector: "#output" },
              kind: "text",
              equals: "Observed",
            },
          ],
        })
      ).verified,
    ).toBe(true);
    await page.bringToFront();
    await worker.evaluate(
      ({ tabId }) => chrome.tabs.sendMessage(tabId, { action: "startPicking" }),
      { tabId },
    );
    await page.locator("#card").click({ position: { x: 12, y: 12 } });
    expect((await tool("selected")).element.id).toBe("card");
    const capture = await client.callTool({
      name: "capture",
      arguments: { tabId, target: { ref: card.ref } },
    });
    expect(capture.isError, JSON.stringify(capture)).not.toBe(true);
    expect(capture.content[1].type).toBe("image");
    expect(capture.content[1].data.length).toBeGreaterThan(100);
    const pixel = await page.evaluate(async (data) => {
      const img = await createImageBitmap(
        await (await fetch("data:image/png;base64," + data)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return Array.from(
        canvas.getContext("2d").getImageData(12, 12, 1, 1).data,
      );
    }, capture.content[1].data);
    expect(pixel).toEqual([225, 238, 226, 255]);
    await worker.evaluate(
      ({ tabId }) => chrome.tabs.sendMessage(tabId, { action: "stopPicking" }),
      { tabId },
    );
    await panelPage.bringToFront();
    await panelPage.locator("#refresh").click();
    await expect(panelPage.locator("#selection")).toContainText("#card");
    await panelPage.locator("#intent").fill("Align the cards");
    await panelPage.locator("#task").click();
    await expect(panelPage.locator("#result")).toContainText("styleprobe-task");
    await panelPage.locator("#changes").fill('{"width":"260px"}');
    await panelPage.locator("#preview").click();
    await expect(page.locator("#card")).toHaveCSS("width", "260px");
    await panelPage.locator("#undo").click();
    await expect(page.locator("#card")).toHaveCSS("width", "240px");
    await panelPage.locator('[data-view="design"]').click();
    await panelPage
      .locator("#designChecks")
      .fill('[{"kind":"rect","property":"width","equals":240}]');
    await panelPage.locator("#assert").click();
    await expect(panelPage.locator("#resultSummary")).toContainText("通过");
    await panelPage.locator('[data-view="diagnose"]').click();
    await panelPage.locator("#diagnose").click();
    await expect(panelPage.locator("#result")).toContainText("hitTest");
    await panelPage.locator('[data-view="extract"]').click();
    await panelPage.locator("#extract").click();
    const downloadEvent = panelPage.waitForEvent("download");
    await panelPage.locator("#downloadComponent").click();
    const download = await downloadEvent;
    expect(await readFile(await download.path(), "utf8")).toContain(
      "Agent Probe",
    );
    await panelPage.locator('[data-view="verify"]').click();
    await panelPage.locator("#snapshot").click();
    await panelPage.locator("#diff").click();
    await expect(panelPage.locator("#result")).toContainText(
      '"changed": false',
    );
    await panelPage.locator('[data-view="task"]').click();
    await expect(panelPage.locator('[data-view="task"]')).toHaveClass(/active/);
    expect(
      await panelPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panelPage.screenshot({
      path: "test-results/agent-panel.png",
      fullPage: true,
    });
    await worker.evaluate((id) => chrome.windows.remove(id), window.id);
    const other = await context.newPage();
    await other.goto(`http://127.0.0.1:${port}/other`);
    const allTabs = await tool("list_tabs");
    const otherId = allTabs.find((t) => t.url.endsWith("/other")).tabId;
    const cross = await client.callTool({
      name: "inspect",
      arguments: { tabId: otherId, target: { ref: card.ref } },
    });
    expect(cross.isError).toBe(true);
    const inactive = await client.callTool({
      name: "capture",
      arguments: { tabId },
    });
    expect(inactive.isError).toBe(true);
    await page.reload();
    const stale = await client.callTool({
      name: "inspect",
      arguments: { tabId, target: { ref: card.ref } },
    });
    expect(stale.isError).toBe(true);
    const refreshed = await tool("diff", {
      snapshotId: snapshot.snapshotId,
      target: { selector: "#card" },
    });
    expect(refreshed.changed).toBe(false);
  } finally {
    await context?.close();
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
