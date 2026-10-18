import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
export async function createRelay({
  port = 19817,
  token,
  timeout = 20000,
} = {}) {
  if (typeof token !== "string" || token.length < 24)
    throw new Error("Pairing token must have at least 24 characters.");
  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 12 * 1024 * 1024,
  });
  let browser = null;
  const pending = new Map();
  function rejectPending(message) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
    pending.clear();
  }
  http.on("upgrade", (req, socket, head) => {
    if (
      !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || "") ||
      req.url !== "/probe"
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws) => {
    let authorized = false;
    const deadline = setTimeout(
      () => ws.close(1008, "Authentication timeout"),
      3000,
    );
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(1008, "Invalid JSON");
        return;
      }
      if (!authorized) {
        const a = Buffer.from(String(msg.token || "")),
          b = Buffer.from(token);
        if (
          msg.type !== "hello" ||
          a.length !== b.length ||
          !timingSafeEqual(a, b)
        ) {
          ws.close(1008, "Invalid pairing token");
          return;
        }
        if (browser?.readyState === WebSocket.OPEN) {
          ws.close(1008, "Another extension is connected");
          return;
        }
        authorized = true;
        clearTimeout(deadline);
        browser = ws;
        ws.send(JSON.stringify({ type: "ready" }));
        return;
      }
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      const item = pending.get(msg.id);
      if (!item) return;
      pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.ok) item.resolve(msg.result);
      else
        item.reject(
          Object.assign(new Error(msg.error?.message || "Probe failed"), {
            code: msg.error?.code,
          }),
        );
    });
    ws.on("close", () => {
      clearTimeout(deadline);
      if (browser === ws) {
        browser = null;
        rejectPending("Browser disconnected. Reconnect the extension.");
      }
    });
  });
  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: http.address().port,
    call(method, args) {
      if (browser?.readyState !== WebSocket.OPEN)
        return Promise.reject(
          new Error(
            "Browser not connected. Open StyleProbe and pair the local bridge.",
          ),
        );
      if (pending.size >= 32)
        return Promise.reject(new Error("Too many pending probe requests."));
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              "Probe request timed out. Inspect state before retrying a mutation.",
            ),
          );
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        browser.send(JSON.stringify({ id, method, args }));
      });
    },
    async close() {
      rejectPending("Bridge closed.");
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
