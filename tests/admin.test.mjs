// Browser tests for the CRM (/admin) against a fake Supabase.
// Needs Chrome or Edge, and internet access for supabase-js from jsDelivr.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSupabase } from "./support/fake-supabase.mjs";
import { browserPath, launchBrowser } from "./support/browser.mjs";
import { adminState, USERS, TODAY, TOMORROW } from "./support/admin-state.mjs";

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

// Opens the CRM signed in, on the given screen, and waits for it to finish loading.
async function signedIn(who, hash = "", state = adminState(), ready = "[data-screen]") {
  await openAdmin(state, hash);
  await signInAs(who);
  await page.waitFor(`document.querySelector(".app-shell") && document.querySelector(${JSON.stringify(ready)})`, 10000);
}

const patches = (table) => server.calls.filter((c) => c.method === "PATCH" && c.path === `/rest/v1/${table}`);
const bookingCard = (id) => `.booking[data-id="${id}"]`;

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

// Schedule ------------------------------------------------------------------

test("the schedule lists the day's bookings in time order with contact links", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  assert.deepEqual(await page.eval(`[...document.querySelectorAll(".booking")].map(b => b.dataset.id)`), ["b-1", "b-2"]);
  const first = bookingCard("b-1");
  assert.equal(await page.text(`${first} .booking-time`), "10:00 AM to 10:45 AM");
  assert.equal(await page.text(`${first} .booking-name`), "Ana <i>Cruz</i>");
  assert.equal(await page.eval(`document.querySelector('${first} .booking-name i')`), null);
  assert.ok(await page.eval(`!!document.querySelector('${first} a[href="tel:09171234567"]')`));
  assert.ok(await page.eval(`!!document.querySelector('${first} a[href="sms:09171234567"]')`));
  assert.equal(await page.text(`${first} .booking-service`), "Manicure");
  assert.equal(await page.text(`${first} .badge.source`), "Website");
  assert.equal(await page.text(`${first} .badge.status`), "Confirmed");
  assert.equal(await page.text(`${bookingCard("b-2")} .badge.source`), "Chat");
  assert.equal(await page.text(`${bookingCard("b-2")} .badge.status`), "Pending");
  assert.deepEqual(page.errors, []);
});

test("status buttons follow each booking's status", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  const labels = (id) => page.eval(`[...document.querySelectorAll('${bookingCard(id)} [data-status]')].map(b => b.textContent.trim())`);
  assert.deepEqual(await labels("b-1"), ["Completed", "No-show", "Cancel"]);
  assert.deepEqual(await labels("b-2"), ["Confirm", "Cancel"]);
});

test("marking a booking completed saves it and leaves it read-only", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  await page.click(`${bookingCard("b-1")} [data-status="completed"]`);
  await page.waitFor(`document.querySelector('${bookingCard("b-1")} .badge.status').textContent.trim() === "Completed"`);
  const call = patches("bookings")[0];
  assert.equal(call.query.id, "eq.b-1");
  assert.deepEqual(call.body, { status: "completed" });
  assert.equal(await page.eval(`document.querySelectorAll('${bookingCard("b-1")} [data-status]').length`), 0);
});

test("cancelling asks first", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  await page.click(`${bookingCard("b-2")} [data-status="cancelled"]`);
  await page.waitFor(`document.querySelector("dialog[open]")`);
  await page.click(`dialog[open] button[value="no"]`);
  await page.waitFor(`!document.querySelector("dialog")`);
  assert.equal(patches("bookings").length, 0);
  await page.click(`${bookingCard("b-2")} [data-status="cancelled"]`);
  await page.waitFor(`document.querySelector("dialog[open]")`);
  await page.click("#confirm-yes");
  await page.waitFor(`document.querySelector('${bookingCard("b-2")} .badge.status').textContent.trim() === "Cancelled"`);
  assert.deepEqual(patches("bookings")[0].body, { status: "cancelled" });
});

test("notes can be edited in place", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  assert.equal(await page.eval(`document.querySelector('${bookingCard("b-1")} textarea').value`), "Likes short nails");
  await page.fill(`${bookingCard("b-1")} textarea`, "Likes short, square nails");
  await page.click(`${bookingCard("b-1")} [data-save-notes]`);
  await page.waitFor(`document.getElementById("toast").textContent === "Notes saved"`);
  assert.deepEqual(patches("bookings")[0].body, { notes: "Likes short, square nails" });
});

test("a refused change shows why and keeps the booking as it was", { skip }, async () => {
  const state = adminState();
  state.deny = ["PATCH bookings"];
  await signedIn("staff", "", state, "#schedule");
  await page.click(`${bookingCard("b-1")} [data-status="no_show"]`);
  await page.waitFor(`document.getElementById("toast").textContent !== ""`);
  assert.equal(await page.text("#toast"), "You don't have permission for that.");
  assert.equal(await page.text(`${bookingCard("b-1")} .badge.status`), "Confirmed");
});

test("the day picker moves between days", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  await page.click("#next-day");
  await page.waitFor(`location.hash === "#/schedule?date=${TOMORROW}" && document.querySelector("#screen .empty")`);
  assert.equal(await page.text("#screen .empty"), "No bookings on this day.");
  await page.click("#today");
  await page.waitFor(`document.querySelectorAll(".booking").length === 2`);
});

test("the busy strip shows each group's load and flags overbooked times", { skip }, async () => {
  const state = adminState();
  const extra = { ...state.tables.bookings[0], id: "b-9", booking_id: "b-9", customer_name: "Cara Reyes" };
  state.tables.bookings.push(extra);
  await signedIn("staff", "", state, "#schedule");
  assert.equal(await page.text(`.cap-slot[data-slot="10:00"]`), "10:00 AM Nails 2/1");
  assert.ok(await page.eval(`document.querySelector('.cap-slot[data-slot="10:00"]').classList.contains("over")`));
  assert.equal(await page.text(`.cap-slot[data-slot="11:00"]`), "11:00 AM Hair 1/2");
  assert.equal(await page.eval(`document.querySelector('.cap-slot[data-slot="11:00"]').classList.contains("over")`), false);
});
