// Browser tests for the CRM (/admin) against a fake Supabase.
// Needs Chrome or Edge, and internet access for supabase-js from jsDelivr.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSupabase } from "./support/fake-supabase.mjs";
import { browserPath, launchBrowser } from "./support/browser.mjs";
import { adminState, USERS } from "./support/admin-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";

let skip = browserPath ? false : "no Chrome or Edge found";
if (!skip) {
  try { await fetch(SUPABASE_JS, { method: "HEAD" }); } catch { skip = "cannot reach jsDelivr for supabase-js"; }
}

let server, browser, page;

before(async () => {
  if (skip) return;
  server = await startFakeSupabase({ root: ROOT, state: adminState() });
  browser = await launchBrowser();
});

after(async () => {
  if (skip) return;
  await browser.close();
  await server.close();
});

async function openAdmin(state = adminState(), hash = "") {
  if (page) await page.close();
  server.state = state;
  server.calls.length = 0;
  page = await browser.newPage();
  await page.goto(`${server.origin}/admin/${hash}`);
  await page.waitFor(`document.querySelector("#login-form, .app-shell, .center-card")`, 15000);
  return page;
}

async function signInAs(who) {
  await page.fill("#login-email", USERS[who].email);
  await page.fill("#login-password", USERS[who].password);
  await page.click("#login-form button[type=submit]");
}

const navLabels = () => page.eval(`[...document.querySelectorAll(".nav-link")].map(a => a.textContent.trim())`);

test("shows the sign-in screen when nobody is logged in", { skip }, async () => {
  await openAdmin();
  assert.ok(await page.eval(`!!document.getElementById("login-form")`));
  assert.deepEqual(page.errors, []);
});

test("a wrong password shows a clear message", { skip }, async () => {
  await openAdmin();
  await page.fill("#login-email", USERS.staff.email);
  await page.fill("#login-password", "wrong");
  await page.click("#login-form button[type=submit]");
  await page.waitFor(`document.getElementById("login-error").textContent !== ""`);
  assert.equal(await page.text("#login-error"), "Wrong email or password.");
});

test("forgot password sends a reset link", { skip }, async () => {
  await openAdmin();
  await page.fill("#login-email", USERS.staff.email);
  await page.click("#forgot-password");
  await page.waitFor(`document.getElementById("login-message").textContent !== ""`);
  assert.equal(await page.text("#login-message"), "If that email has a login, a reset link is on its way.");
  assert.equal(server.callsTo("/auth/v1/recover").length, 1);
});

test("an unapproved login is asked to wait", { skip }, async () => {
  await openAdmin();
  await signInAs("pending");
  await page.waitFor(`document.body.textContent.includes("Waiting for the owner to approve your account")`);
  assert.equal(await page.eval(`!!document.querySelector(".app-shell")`), false);
});

test("staff see the booking screens but not the owner screens", { skip }, async () => {
  await openAdmin();
  await signInAs("staff");
  await page.waitFor(`document.querySelector(".app-shell")`);
  assert.deepEqual(await navLabels(), ["Schedule", "New booking", "Customers"]);
  await page.eval(`location.hash = "#/services"`);
  await page.waitFor(`document.querySelector('.nav-link[aria-current="page"]')?.dataset.route === "schedule"`);
});

test("the owner also sees services, hours and staff", { skip }, async () => {
  await openAdmin();
  await signInAs("owner");
  await page.waitFor(`document.querySelector(".app-shell")`);
  assert.deepEqual(await navLabels(), ["Schedule", "New booking", "Customers", "Services", "Hours", "Staff"]);
});

test("signing out returns to the sign-in screen", { skip }, async () => {
  await openAdmin();
  await signInAs("staff");
  await page.waitFor(`document.querySelector(".app-shell")`);
  await page.click("#sign-out");
  await page.waitFor(`document.getElementById("login-form")`);
});
