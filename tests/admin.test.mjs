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

// New booking ---------------------------------------------------------------

const rpcCalls = (fn) => server.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);

async function pickServiceAndTime(serviceId, time) {
  await page.click(`input[name="service"][value="${serviceId}"]`);
  await page.waitFor(`document.querySelectorAll("#nb-time option").length > 1`);
  await page.fill("#nb-time", time);
}

test("a walk-in booking goes through the shared booking check", { skip }, async () => {
  await signedIn("staff", "#/new");
  await pickServiceAndTime(5, "13:00");
  assert.deepEqual(rpcCalls("get_available_slots").at(-1).body, { p_booking_date: TODAY, p_service_id: 5 });
  await page.fill("#nb-phone", "0917 999 8888");
  await page.waitFor(`document.getElementById("nb-name").value === "Bea Santos"`);
  assert.equal(await page.text("#phone-found"), "Existing customer: Bea Santos");
  await page.fill("#nb-notes", "Walked in with a friend");
  await page.click("#new-booking [type=submit]");
  await page.waitFor(`location.hash === "#/schedule?date=${TODAY}"`);
  assert.deepEqual(rpcCalls("create_booking")[0].body, {
    p_full_name: "Bea Santos", p_phone: "09179998888", p_email: null, p_service_id: 5,
    p_booking_date: TODAY, p_start_time: "13:00", p_notes: "Walked in with a friend",
    p_sms_opt_in: false, p_source: "walk_in"
  });
  assert.deepEqual(page.errors, []);
});

test("phone bookings are saved as phone bookings", { skip }, async () => {
  await signedIn("staff", "#/new");
  await page.click(`input[name="source"][value="phone"]`);
  await pickServiceAndTime(1, "13:30");
  await page.fill("#nb-phone", "09170001111");
  await page.fill("#nb-name", "New Person");
  await page.click("#new-booking [type=submit]");
  await page.waitFor(`location.hash.startsWith("#/schedule")`);
  const body = rpcCalls("create_booking")[0].body;
  assert.equal(body.p_source, "phone");
  assert.equal(body.p_full_name, "New Person");
});

test("a walk-in today can start now", { skip }, async () => {
  const state = adminState();
  Object.assign(state.tables.salon_settings[0], { open_time: "00:00:00", close_time: "23:59:00" });
  await signedIn("staff", "#/new", state);
  await page.click(`input[name="service"][value="5"]`);
  await page.waitFor(`document.querySelectorAll("#nb-time option").length > 1`);
  assert.match(await page.text("#nb-time option:nth-child(2)"), /^Now \(\d{1,2}:\d{2} [AP]M\)$/);
  await page.click(`input[name="source"][value="phone"]`);
  await page.waitFor(`!document.querySelector("#nb-time option:nth-child(2)").textContent.startsWith("Now")`);
});

test("missing details are flagged before anything is saved", { skip }, async () => {
  await signedIn("staff", "#/new");
  await page.click("#new-booking [type=submit]");
  assert.equal(await page.text("#err-service"), "Choose a service.");
  assert.equal(await page.text("#err-time"), "Choose a time.");
  assert.equal(await page.text("#err-name"), "Enter the customer's name.");
  assert.equal(await page.text("#err-phone"), "Enter an 11-digit mobile number starting with 09.");
  assert.equal(rpcCalls("create_booking").length, 0);
});

test("a refused booking shows the reason and refreshes the times", { skip }, async () => {
  const state = adminState();
  state.rpc.create_booking = () => ({ success: false, code: "slot_taken", message: "Sorry, everyone is booked at that time. Please choose another time." });
  await signedIn("staff", "#/new", state);
  await pickServiceAndTime(5, "13:00");
  await page.fill("#nb-phone", "09170001111");
  await page.fill("#nb-name", "New Person");
  const before = rpcCalls("get_available_slots").length;
  await page.click("#new-booking [type=submit]");
  await page.waitFor(`document.getElementById("booking-error").textContent !== ""`);
  assert.equal(await page.text("#booking-error"), "Sorry, everyone is booked at that time. Please choose another time.");
  await page.waitFor(`true`);
  assert.ok(rpcCalls("get_available_slots").length > before);
});

test("a closed day shows its reason instead of times", { skip }, async () => {
  const state = adminState();
  state.rpc.get_available_slots = () => ({ success: true, closed: true, closed_reason: "We're closed that day (Fiesta).", open_count: 0, available_times: [] });
  await signedIn("staff", "#/new", state);
  await page.click(`input[name="service"][value="5"]`);
  await page.waitFor(`document.getElementById("err-date").textContent !== ""`);
  assert.equal(await page.text("#err-date"), "We're closed that day (Fiesta).");
  assert.equal(await page.eval(`document.getElementById("nb-time").disabled`), true);
});

test("Book again opens with the customer filled in", { skip }, async () => {
  await signedIn("staff", "#/new?customer=c-ana");
  assert.equal(await page.eval(`document.getElementById("nb-name").value`), "Ana <i>Cruz</i>");
  assert.equal(await page.eval(`document.getElementById("nb-phone").value`), "09171234567");
  assert.equal(await page.eval(`document.getElementById("nb-sms").checked`), true);
});

// Customers -----------------------------------------------------------------

const rowNames = () => page.eval(`[...document.querySelectorAll(".customer-row strong")].map(s => s.textContent)`);

test("customers can be searched by name or phone", { skip }, async () => {
  await signedIn("staff", "#/customers", adminState(), ".customer-row");
  assert.deepEqual(await rowNames(), ["Bea Santos", "Ana <i>Cruz</i>"]);
  await page.fill("#customer-search", "ana");
  await page.waitFor(`document.querySelectorAll(".customer-row").length === 1`);
  assert.deepEqual(await rowNames(), ["Ana <i>Cruz</i>"]);
  await page.fill("#customer-search", "0917 999");
  await page.waitFor(`document.querySelector(".customer-row strong")?.textContent === "Bea Santos"`);
  await page.fill("#customer-search", "nobody");
  await page.waitFor(`document.querySelector("#customer-results .empty")`);
  assert.equal(await page.text("#customer-results .empty"), "No customers match that search.");
});

test("a customer's page shows their details, visit summary and history", { skip }, async () => {
  await signedIn("staff", "#/customers/c-ana", adminState(), "#customer-form");
  assert.equal(await page.text("#customer-name"), "Ana <i>Cruz</i>");
  assert.equal(await page.text("#stat-completed"), "1");
  assert.equal(await page.text("#stat-noshows"), "1");
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#upcoming .history-item")].map(i => i.dataset.id)`), ["b-1"]);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#past .history-item")].map(i => i.dataset.id)`), ["b-4", "b-3"]);
  assert.deepEqual(page.errors, []);
});

test("customer details can be edited", { skip }, async () => {
  await signedIn("staff", "#/customers/c-bea", adminState(), "#customer-form");
  await page.fill("#cu-email", "bea@example.com");
  await page.eval(`document.getElementById("cu-sms").click()`);
  await page.click("#customer-form [type=submit]");
  await page.waitFor(`document.getElementById("toast").textContent === "Customer saved"`);
  const call = patches("customers")[0];
  assert.equal(call.query.id, "eq.c-bea");
  assert.deepEqual(call.body, { full_name: "Bea Santos", phone: "09179998888", email: "bea@example.com", sms_opt_in: true });
});

test("a phone number another customer has is refused clearly", { skip }, async () => {
  const state = adminState();
  state.errors = { "PATCH customers": { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint \"customers_phone_key\"" } } };
  await signedIn("staff", "#/customers/c-bea", state, "#customer-form");
  await page.fill("#cu-phone", "09171234567");
  await page.click("#customer-form [type=submit]");
  await page.waitFor(`document.getElementById("customer-error").textContent !== ""`);
  assert.equal(await page.text("#customer-error"), "Another customer already has that phone number.");
});

test("an invalid phone number is caught before saving", { skip }, async () => {
  await signedIn("staff", "#/customers/c-bea", adminState(), "#customer-form");
  await page.fill("#cu-phone", "12345");
  await page.click("#customer-form [type=submit]");
  assert.equal(await page.text("#customer-error"), "Enter an 11-digit mobile number starting with 09.");
  assert.equal(patches("customers").length, 0);
});

test("Book again starts a booking for this customer", { skip }, async () => {
  await signedIn("staff", "#/customers/c-ana", adminState(), "#customer-form");
  await page.click("#book-again");
  await page.waitFor(`location.hash === "#/new?customer=c-ana" && document.getElementById("nb-name")?.value === "Ana <i>Cruz</i>"`);
});

test("the schedule links to the customer's page", { skip }, async () => {
  await signedIn("staff", "", adminState(), "#schedule");
  await page.click(`${bookingCard("b-2")} .booking-name a`);
  await page.waitFor(`document.getElementById("customer-name")?.textContent === "Bea Santos"`);
});

// Services (owner) ----------------------------------------------------------

const posts = (table) => server.calls.filter((c) => c.method === "POST" && c.path === `/rest/v1/${table}`);
const deletes = (table) => server.calls.filter((c) => c.method === "DELETE" && c.path === `/rest/v1/${table}`);
const serviceRow = (id) => `.service-row[data-id="${id}"]`;
const serviceOrder = () => page.eval(`[...document.querySelectorAll(".service-row")].map(r => r.dataset.id)`);

test("the services list shows each service with its details", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  assert.deepEqual(await serviceOrder(), ["1", "5", "7"]);
  assert.equal(await page.text(`${serviceRow(1)} .service-summary`), "60 min, ₱450, Hair");
  assert.equal(await page.text(`${serviceRow(7)} .badge`), "Hidden");
  assert.deepEqual(page.errors, []);
});

test("the owner can change a service's price", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  await page.click(`${serviceRow(1)} [data-edit]`);
  await page.waitFor(`document.getElementById("service-form")`);
  assert.equal(await page.eval(`document.getElementById("sv-name").value`), "Haircut (Women)");
  await page.fill("#sv-price", "500");
  await page.click("#service-form [type=submit]");
  await page.waitFor(`document.getElementById("toast").textContent === "Service saved"`);
  const call = patches("services")[0];
  assert.equal(call.query.id, "eq.1");
  assert.equal(call.body.price, 500);
  assert.equal(call.body.duration_minutes, 60);
  await page.waitFor(`document.querySelector('${serviceRow(1)} .service-summary')?.textContent.includes("₱500")`);
});

test("the owner can add a service", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  await page.click("#add-service");
  await page.waitFor(`document.getElementById("service-form")`);
  await page.fill("#sv-name", "Blowout");
  await page.fill("#sv-description", "Wash and blow-dry");
  await page.click(`input[name="sv-icon"][value="i-drop"]`);
  await page.fill("#sv-duration", "30");
  await page.fill("#sv-price", "300");
  await page.fill("#sv-group", "hair");
  await page.click("#service-form [type=submit]");
  await page.waitFor(`[...document.querySelectorAll(".service-row h3")].some(h => h.textContent === "Blowout")`);
  assert.deepEqual(posts("services")[0].body, {
    name: "Blowout", description: "Wash and blow-dry", icon: "i-drop", duration_minutes: 30,
    price: 300, staff_group: "hair", is_active: true, sort_order: 4
  });
});

test("a service needs a name, a duration and a price", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  await page.click("#add-service");
  await page.waitFor(`document.getElementById("service-form")`);
  await page.fill("#sv-price", "-5");
  await page.click("#service-form [type=submit]");
  assert.equal(await page.text("#sv-error"), "Enter a name, a duration above 0 minutes, and a price of 0 or more.");
  assert.equal(posts("services").length, 0);
});

test("hiding a service with upcoming bookings warns first", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  await page.click(`${serviceRow(5)} [data-toggle]`);
  await page.waitFor(`document.querySelector("dialog[open]")`);
  assert.match(await page.text("dialog[open] p"), /1 upcoming booking/);
  await page.click(`dialog[open] button[value="no"]`);
  await page.waitFor(`!document.querySelector("dialog")`);
  assert.equal(patches("services").length, 0);
  await page.click(`${serviceRow(5)} [data-toggle]`);
  await page.waitFor(`document.querySelector("dialog[open]")`);
  await page.click("#confirm-yes");
  await page.waitFor(`document.querySelector('${serviceRow(5)} .badge')?.textContent === "Hidden"`);
  assert.equal(patches("services")[0].body.is_active, false);
});

test("services can be reordered", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".service-row");
  await page.click(`${serviceRow(1)} [data-move="down"]`);
  await page.waitFor(`document.querySelector(".service-row").dataset.id === "5"`);
  assert.deepEqual(await serviceOrder(), ["5", "1", "7"]);
  assert.equal(patches("services").length, 2);
  assert.equal(await page.eval(`document.querySelector('${serviceRow(5)} [data-move="up"]').disabled`), true);
});

test("staff counts can be changed and groups added", { skip }, async () => {
  await signedIn("owner", "#/services", adminState(), ".group-row");
  await page.fill(`.group-row[data-name="hair"] input`, "3");
  await page.click(`.group-row[data-name="hair"] [data-save-group]`);
  await page.waitFor(`document.getElementById("toast").textContent === "Staff count saved"`);
  assert.equal(patches("staff_groups")[0].query.name, "eq.hair");
  assert.deepEqual(patches("staff_groups")[0].body, { staff_count: 3 });
  await page.fill("#new-group-name", "Lashes");
  await page.fill("#new-group-count", "1");
  await page.click("#add-group");
  await page.waitFor(`document.querySelector('.group-row[data-name="lashes"]')`);
  assert.deepEqual(posts("staff_groups")[0].body, { name: "lashes", staff_count: 1 });
});

// Hours (owner) -------------------------------------------------------------

const weekday = (date) => new Date(date + "T00:00:00Z").getUTCDay();

test("opening hours can be changed", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#hours-form");
  assert.equal(await page.eval(`document.getElementById("hr-open").value`), "09:00");
  await page.fill("#hr-close", "18:30");
  await page.fill("#hr-slot", "60");
  await page.click("#hours-form [type=submit]");
  await page.waitFor(`document.getElementById("toast").textContent === "Hours saved"`);
  assert.deepEqual(patches("salon_settings")[0].body, {
    open_time: "09:00", close_time: "18:30", slot_minutes: 60, closed_weekdays: [],
    salon_name: "Glow Salon", salon_phone: "0917 000 0000"
  });
});

test("hours that clash with bookings list them and need Save anyway", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#hours-form");
  await page.fill("#hr-open", "10:30");
  await page.click("#hours-form [type=submit]");
  await page.waitFor(`document.getElementById("clash-list")`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#clash-list li")].map(li => li.dataset.id)`), ["b-1"]);
  assert.match(await page.text("#clash-list li"), /Ana <i>Cruz<\/i>.*Starts before opening/);
  assert.equal(patches("salon_settings").length, 0);
  await page.click("#save-anyway");
  await page.waitFor(`document.getElementById("toast").textContent === "Hours saved"`);
  assert.equal(patches("salon_settings")[0].body.open_time, "10:30");
});

test("closing on a weekday that has bookings warns first", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#hours-form");
  await page.click(`input[name="hr-closed"][value="${weekday(TODAY)}"]`);
  await page.click("#hours-form [type=submit]");
  await page.waitFor(`document.getElementById("clash-list")`);
  assert.equal(await page.eval(`document.querySelectorAll("#clash-list li").length`), 2);
});

test("closing time must be after opening time", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#hours-form");
  await page.fill("#hr-open", "18:00");
  await page.fill("#hr-close", "09:00");
  await page.click("#hours-form [type=submit]");
  assert.equal(await page.text("#hr-error"), "Closing time must be after opening time.");
  assert.equal(patches("salon_settings").length, 0);
});

test("holidays can be added and removed", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#closure-form");
  await page.fill("#cl-date", TOMORROW);
  await page.fill("#cl-reason", "Fiesta");
  await page.click("#closure-form [type=submit]");
  await page.waitFor(`document.querySelector('.closure-row[data-date="${TOMORROW}"]')`);
  assert.deepEqual(posts("closed_dates")[0].body, { closed_on: TOMORROW, reason: "Fiesta" });
  await page.click(`.closure-row[data-date="${TOMORROW}"] [data-remove]`);
  await page.waitFor(`!document.querySelector('.closure-row[data-date="${TOMORROW}"]')`);
  assert.equal(deletes("closed_dates")[0].query.closed_on, `eq.${TOMORROW}`);
});

test("a holiday on a day with bookings warns first", { skip }, async () => {
  await signedIn("owner", "#/hours", adminState(), "#closure-form");
  await page.fill("#cl-date", TODAY);
  await page.click("#closure-form [type=submit]");
  await page.waitFor(`document.getElementById("clash-list")`);
  assert.equal(await page.eval(`document.querySelectorAll("#clash-list li").length`), 2);
  assert.equal(posts("closed_dates").length, 0);
  await page.click("#save-anyway");
  await page.waitFor(`document.querySelector('.closure-row[data-date="${TODAY}"]')`);
});

// Staff (owner) -------------------------------------------------------------

test("the owner can approve a new login and cannot change their own", { skip }, async () => {
  await signedIn("owner", "#/staff", adminState(), ".staff-row");
  assert.equal(await page.eval(`document.querySelectorAll(".staff-row").length`), 3);
  assert.equal(await page.eval(`!!document.querySelector('.staff-row[data-id="u-owner"] select')`), false);
  assert.match(await page.text(`.staff-row[data-id="u-owner"]`), /Owner \(you\)/);
  await page.fill(`.staff-row[data-id="u-pending"] select`, "staff");
  await page.waitFor(`document.getElementById("toast").textContent === "Access updated"`);
  const call = patches("staff_profiles")[0];
  assert.equal(call.query.user_id, "eq.u-pending");
  assert.deepEqual(call.body, { role: "staff" });
  assert.ok(await page.eval(`!!document.querySelector('a[href^="https://supabase.com/dashboard"]')`));
});
