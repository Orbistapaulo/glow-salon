// Checks on what gets deployed to Vercel and on user-facing copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

function filesUnder(dir) {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(ROOT, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

test("search engines are kept out of the CRM", () => {
  assert.match(read("robots.txt"), /^Disallow: \/admin$/m);
  assert.match(read("admin/index.html"), /<meta name="robots" content="noindex, nofollow">/);
});

test("Vercel serves /admin and refuses to frame it", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.ok(config.rewrites.some((r) => r.source === "/" && r.destination === "/index.htm"), "home page rewrite kept");
  assert.ok(config.rewrites.some((r) => r.source === "/admin" && r.destination === "/admin/index.html"));
  const admin = config.headers.find((h) => h.source === "/admin(.*)");
  const header = (key) => admin.headers.find((x) => x.key === key)?.value;
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("X-Robots-Tag"), "noindex, nofollow");
});

test("third-party scripts are pinned to exact versions", () => {
  // The CRM shares the site's origin, so an auto-updating script could reach its login.
  const sources = [read("index.htm"), ...filesUnder("admin").map(read)].join("\n");
  const urls = sources.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"'`\s)]+/g) || [];
  assert.ok(urls.length > 0);
  for (const url of urls) assert.match(url, /@\d+\.\d+\.\d+\//, `${url} is not pinned`);
});

test("the site's links point at its real address", () => {
  const SITE = "https://glow-salon-tau.vercel.app/";
  const files = ["index.htm", "robots.txt", "sitemap.xml", "supabase/README.md"];
  for (const file of files) assert.doesNotMatch(read(file), /salon-booking\.vercel\.app/, `${file} points at another site`);
  assert.match(read("index.htm"), new RegExp(`<link rel="canonical" href="${SITE}">`));
  assert.match(read("sitemap.xml"), new RegExp(`<loc>${SITE}</loc>`));
});

test("project files that are not the website are not deployed", () => {
  const ignored = read(".vercelignore").split(/\r?\n/).map((l) => l.trim());
  for (const entry of ["docs", "supabase", "tests", ".superpowers"]) assert.ok(ignored.includes(entry), `${entry} ignored`);
});

test("user-facing copy has no em-dashes or en-dashes", () => {
  const files = ["index.htm", ...filesUnder("admin"), ...filesUnder("supabase/migrations"), "supabase/README.md", "tests/crm-checklist.md"];
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const file of files) {
    assert.doesNotMatch(read(file), dashes, `${file} contains a dash character`);
  }
});
