// Hash routes: #/screen[/id][?query]. Pure functions, tested in tests/routes.test.mjs.

const KNOWN = new Set(["schedule", "new", "customers", "services", "hours", "staff"]);
export const OWNER_ONLY = new Set(["services", "hours", "staff"]);

export function parseRoute(hash) {
  if (!hash || !hash.startsWith("#/")) return { name: "schedule", id: null, params: {} };
  const [pathPart, queryPart = ""] = hash.slice(2).split("?");
  const parts = pathPart.split("/").filter(Boolean);
  return {
    name: parts[0] || "schedule",
    id: parts[1] ? decodeURIComponent(parts[1]) : null,
    params: Object.fromEntries(new URLSearchParams(queryPart))
  };
}

export function buildHash(name, id = null, params = {}) {
  const query = new URLSearchParams(params).toString();
  return `#/${name}${id ? `/${encodeURIComponent(id)}` : ""}${query ? `?${query}` : ""}`;
}

// Screen to show for a route, falling back to the schedule for unknown or off-limits screens.
export function allowedRoute(route, role) {
  if (!KNOWN.has(route.name)) return "schedule";
  if (OWNER_ONLY.has(route.name) && role !== "owner") return "schedule";
  return route.name;
}
