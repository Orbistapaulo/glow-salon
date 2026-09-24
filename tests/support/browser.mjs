// Drives a headless Chrome or Edge over the DevTools protocol, with no npm packages.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

export const browserPath = CANDIDATES.find((p) => existsSync(p));

export async function launchBrowser() {
  const profile = mkdtempSync(path.join(os.tmpdir(), "glow-browser-"));
  const proc = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("browser did not start")), 20000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // Each page gets its own browser context, so storage (like a saved login) never leaks between tests.
  async function newPage() {
    const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const errors = [];
    listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description || d.text);
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
    const s = (method, params) => send(method, params, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");

    const page = {
      errors,
      async goto(url) {
        const loaded = new Promise((resolve) => {
          const l = (msg) => {
            if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") { listeners.delete(l); resolve(); }
          };
          listeners.add(l);
        });
        await s("Page.navigate", { url });
        await loaded;
      },
      async eval(expression) {
        const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async waitFor(expression, timeout = 6000) {
        const end = Date.now() + timeout;
        let last;
        while (Date.now() < end) {
          try { if (await page.eval(`!!(${expression})`)) return; } catch (e) { last = e; }
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`Timed out waiting for: ${expression}${last ? ` (${last.message})` : ""}`);
      },
      text: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`),
      click: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`),
      async fill(selector, value) {
        await page.eval(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        })()`);
      },
      close: () => send("Target.disposeBrowserContext", { browserContextId })
    };
    return page;
  }

  return {
    newPage,
    async close() {
      try { await send("Browser.close"); } catch { /* already closed */ }
      proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser still releasing files */ }
    }
  };
}
