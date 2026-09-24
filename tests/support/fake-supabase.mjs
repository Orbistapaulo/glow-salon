// A small stand-in for Supabase (REST, RPC, Auth) and the n8n booking webhook,
// serving the site's files from the repo. For browser tests only.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".htm": "text/html", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".svg": "image/svg+xml"
};

export const ANON_KEY = "test-anon-key";

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch { resolve(data); }
    });
  });
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

function compare(a, b) {
  const na = Number(a), nb = Number(b);
  if (a !== null && b !== null && a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function matches(row, column, expr) {
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot), value = expr.slice(dot + 1);
  const cell = row[column];
  switch (op) {
    case "eq": return String(cell) === value;
    case "neq": return String(cell) !== value;
    case "gt": return compare(cell, value) > 0;
    case "gte": return compare(cell, value) >= 0;
    case "lt": return compare(cell, value) < 0;
    case "lte": return compare(cell, value) <= 0;
    case "in": return value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(cell));
    case "is": return value === "null" ? cell === null || cell === undefined : String(cell) === value;
    case "ilike": {
      const pattern = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(String(cell ?? ""));
    }
    default: throw new Error(`fake-supabase: unsupported filter ${op}`);
  }
}

function applyFilters(rows, query) {
  let out = rows;
  for (const [key, value] of Object.entries(query)) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    if (key === "or") {
      const parts = value.replace(/^\(|\)$/g, "").split(",");
      out = out.filter((r) => parts.some((p) => {
        const [col, ...rest] = p.split(".");
        return matches(r, col, rest.join("."));
      }));
      continue;
    }
    out = out.filter((r) => matches(r, key, value));
  }
  if (query.order) {
    const keys = query.order.split(",").map((k) => {
      const [col, dir] = k.split(".");
      return { col, desc: dir === "desc" };
    });
    out = [...out].sort((a, b) => {
      for (const k of keys) {
        const c = compare(a[k.col], b[k.col]);
        if (c) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  if (query.limit) out = out.slice(0, Number(query.limit));
  return out;
}

let nextId = 1000;

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `token-${user.id}`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    refresh_token: `refresh-${user.id}`,
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated",
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  };
}

// state: { tables: { name: rows[] }, rpc: { name: (body, state) => json },
//          users: [{ id, email, password }], webhook: (body) => { status, body }, fail: bool }
export async function startFakeSupabase({ root: rootDir, state }) {
  const root = path.resolve(rootDir); // same separators as path.join, for the check below
  const calls = [];
  const api = { state, calls };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const query = Object.fromEntries(url.searchParams);
    const body = await readBody(req);
    calls.push({ method: req.method, path: url.pathname, query, body });
    const s = api.state;
    if (s.delay?.[url.pathname]) await new Promise((r) => setTimeout(r, s.delay[url.pathname]));

    try {
      if (url.pathname === "/webhook/salon-booking") {
        const r = s.webhook ? s.webhook(body) : { status: 200, body: { success: true, message: "Booked." } };
        return send(res, r.status, r.body);
      }

      if (url.pathname.startsWith("/auth/v1/")) {
        const route = url.pathname.slice("/auth/v1/".length);
        if (route === "token") {
          const refresh = query.grant_type === "refresh_token";
          const user = refresh
            ? (s.users || []).find((u) => `refresh-${u.id}` === body?.refresh_token)
            : (s.users || []).find((u) => u.email === body?.email && u.password === body?.password);
          if (!user) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          return send(res, 200, session(user));
        }
        if (route === "user") {
          const token = (req.headers.authorization || "").replace("Bearer ", "");
          const user = (s.users || []).find((u) => `token-${u.id}` === token);
          if (!user) return send(res, 401, { msg: "invalid token" });
          if (req.method === "PUT" && body?.password) user.password = body.password;
          return send(res, 200, session(user).user);
        }
        if (route === "logout") return send(res, 204);
        if (route === "recover") return send(res, 200, {});
        return send(res, 404, { msg: `fake-supabase: no auth route ${route}` });
      }

      if (url.pathname.startsWith("/rest/v1/")) {
        if (s.fail) return send(res, 500, { message: "fake outage" });
        const name = url.pathname.slice("/rest/v1/".length);

        if (name.startsWith("rpc/")) {
          const fn = s.rpc?.[name.slice(4)];
          if (!fn) return send(res, 404, { message: `no rpc ${name}` });
          const out = fn(body || {}, s);
          if (out && out.__error) return send(res, out.status || 400, out.__error);
          return send(res, 200, out);
        }

        const rows = (s.tables[name] ||= []);
        if (s.deny?.includes(`${req.method} ${name}`)) {
          return send(res, 403, { code: "42501", message: `permission denied for table ${name}` });
        }
        const planned = s.errors?.[`${req.method} ${name}`];
        if (planned) return send(res, planned.status, planned.body);
        const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
        const reply = (list) => {
          if (!wantsObject) return send(res, req.method === "POST" ? 201 : 200, list);
          if (list.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          return send(res, 200, list[0]);
        };

        if (req.method === "GET") return reply(applyFilters(rows, query));
        if (req.method === "POST") {
          const items = (Array.isArray(body) ? body : [body]).map((r) => ({ id: r.id ?? nextId++, ...r }));
          if (s.onInsert?.[name]) {
            const err = s.onInsert[name](items, rows);
            if (err) return send(res, 409, err);
          }
          rows.push(...items);
          return reply(items);
        }
        if (req.method === "PATCH") {
          const hit = applyFilters(rows, query);
          hit.forEach((r) => Object.assign(r, body));
          return reply(hit);
        }
        if (req.method === "DELETE") {
          const hit = applyFilters(rows, query);
          s.tables[name] = rows.filter((r) => !hit.includes(r));
          return reply(hit);
        }
      }

      // Static files, with the placeholders pointed at this server
      let file = decodeURIComponent(url.pathname);
      if (file === "/") file = "/index.htm";
      if (file === "/admin" || file === "/admin/") file = "/admin/index.html";
      const full = path.join(root, file);
      if (!full.startsWith(root)) return send(res, 403, "forbidden");
      let content = await readFile(full);
      const ext = path.extname(full);
      if (ext === ".htm" || ext === ".html" || ext === ".js") {
        // Whatever project is configured (placeholder or real), point it at this server.
        content = content.toString()
          .replace(/(const SUPABASE_URL = ")[^"]*(")/g, `$1${origin}$2`)
          .replace(/(const SUPABASE_ANON_KEY = ")[^"]*(")/g, `$1${ANON_KEY}$2`)
          .replace(/const WEBHOOK_URL = "[^"]*"/, `const WEBHOOK_URL = "${origin}/webhook/salon-booking"`)
          .replace(/const CHAT_WEBHOOK_URL = "[^"]*"/, 'const CHAT_WEBHOOK_URL = ""');
      }
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
      res.end(content);
    } catch (err) {
      if (err.code === "ENOENT") return send(res, 404, "not found");
      send(res, 500, { message: String(err.message || err) });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  api.origin = origin;
  api.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
  api.callsTo = (p) => calls.filter((c) => c.path === p);
  return api;
}
