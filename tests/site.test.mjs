// Browser tests for the public booking page (index.htm) against a fake Supabase.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSupabase } from "./support/fake-supabase.mjs";
import { browserPath, launchBrowser } from "./support/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = browserPath ? false : "no Chrome or Edge found";

const iso = (d) => d.toISOString().slice(0, 10);
function nextDate(pred) {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  for (let i = 3; i < 40; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    if (pred(d)) return iso(d);
  }
}
const SUNDAY = nextDate((d) => d.getUTCDay() === 0);
const OPEN_DAY = nextDate((d) => d.getUTCDay() === 3);
const HOLIDAY = nextDate((d) => d.getUTCDay() === 4);

const TIMES = [
  { time: "10:00", label: "10:00 AM", free_staff: 1 },
  { time: "10:30", label: "10:30 AM", free_staff: 1 }
];

function freshState() {
  return {
    tables: {
      services: [
        { id: 1, name: "Cut <b>Deluxe</b>", description: "Wash & style", icon: "i-scissors", duration_minutes: 60, price: 500, is_active: true, sort_order: 1 },
        { id: 2, name: "Hidden Service", description: "Not offered", icon: "i-leaf", duration_minutes: 30, price: 100, is_active: false, sort_order: 2 },
        { id: 5, name: "Manicure", description: "Shape and polish", icon: "i-brush", duration_minutes: 45, price: 300, is_active: true, sort_order: 3 }
      ],
      salon_settings: [{ id: 1, open_time: "09:00:00", close_time: "18:00:00", slot_minutes: 30, closed_weekdays: [0], salon_phone: "0917 555 1234" }],
      closed_dates: [{ closed_on: HOLIDAY, reason: "Fiesta" }]
    },
    rpc: {
      get_available_slots: () => ({ success: true, closed: false, open_count: TIMES.length, available_times: TIMES })
    },
    webhook: () => ({ status: 200, body: { success: true, code: "booked", message: "You're booked for Manicure on Oct 1 at 10:00 AM." } })
  };
}

let server, browser, page;

before(async () => {
  if (skip) return;
  server = await startFakeSupabase({ root: ROOT, state: freshState() });
  browser = await launchBrowser();
});

after(async () => {
  if (skip) return;
  await browser.close();
  await server.close();
});

async function open(state = freshState()) {
  server.state = state;
  server.calls.length = 0;
  page = await browser.newPage();
  await page.goto(`${server.origin}/index.htm`);
  await page.waitFor(`document.querySelectorAll("#service-chips input").length > 0 || document.querySelector("#booking-unavailable")`);
  return page;
}

async function fillBooking(serviceId, date) {
  await page.click(`#service-chips input[value="${serviceId}"]`);
  await page.fill("#booking_date", date);
  await page.waitFor(`document.querySelectorAll("#start_time option").length > 1`);
  await page.fill("#start_time", "10:00");
  await page.fill("#full_name", "Ana Cruz");
  await page.fill("#phone", "0917 123 4567");
}

test("shows active services from the database with their text escaped", { skip }, async () => {
  await open();
  assert.equal(await page.eval(`document.querySelectorAll("#services-grid .service-card").length`), 2);
  assert.equal(await page.text("#services-grid h3"), "Cut <b>Deluxe</b>");
  assert.equal(await page.eval(`document.querySelector("#services-grid h3 b")`), null);
  assert.equal(await page.eval(`document.querySelectorAll("#service-chips input").length`), 2);
  const call = server.callsTo("/rest/v1/services")[0];
  assert.equal(call.query.is_active, "eq.true");
  assert.deepEqual(page.errors, []);
});

test("service cards loaded later still fade in", { skip }, async () => {
  await open();
  await page.eval(`document.getElementById("services").scrollIntoView()`);
  await page.waitFor(`document.querySelector("#services-grid .service-card.visible")`);
});

test("footer hours come from the settings", { skip }, async () => {
  await open();
  assert.equal(await page.text("#footer-hours"), "Open 9:00 AM to 6:00 PM, closed Sundays");
  const state = freshState();
  state.tables.salon_settings[0].closed_weekdays = [];
  await open(state);
  assert.equal(await page.text("#footer-hours"), "Open daily, 9:00 AM to 6:00 PM");
});

test("a closed day shows its reason and offers no times", { skip }, async () => {
  await open();
  await page.click(`#service-chips input[value="1"]`);
  await page.fill("#booking_date", SUNDAY);
  assert.equal(await page.text("#err-date"), "We're closed on Sundays.");
  assert.equal(await page.eval(`document.getElementById("start_time").disabled`), true);
  await page.fill("#booking_date", HOLIDAY);
  assert.equal(await page.text("#err-date"), "We're closed that day (Fiesta).");
  assert.equal(server.callsTo("/rest/v1/rpc/get_available_slots").length, 0);
});

test("an open day lists only the open times from the database", { skip }, async () => {
  await open();
  await page.click(`#service-chips input[value="5"]`);
  await page.fill("#booking_date", OPEN_DAY);
  await page.waitFor(`document.querySelectorAll("#start_time option").length === 3`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#start_time option")].slice(1).map(o => o.value + "|" + o.textContent)`),
    ["10:00|10:00 AM", "10:30|10:30 AM"]);
  const call = server.callsTo("/rest/v1/rpc/get_available_slots").at(-1);
  assert.deepEqual(call.body, { p_booking_date: OPEN_DAY, p_service_id: 5 });
  assert.equal(await page.text("#err-date"), "");
});

test("a fully booked day says so", { skip }, async () => {
  const state = freshState();
  state.rpc.get_available_slots = () => ({ success: true, closed: false, open_count: 0, available_times: [] });
  await open(state);
  await page.click(`#service-chips input[value="5"]`);
  await page.fill("#booking_date", OPEN_DAY);
  await page.waitFor(`document.getElementById("err-time").textContent !== ""`);
  assert.equal(await page.text("#err-time"), "Fully booked that day. Try another date.");
});

test("a successful booking shows the confirmation", { skip }, async () => {
  await open();
  await fillBooking(5, OPEN_DAY);
  await page.click("#submit-btn");
  await page.waitFor(`document.getElementById("status").classList.contains("ok")`);
  assert.equal(await page.text("#status"), "You're booked for Manicure on Oct 1 at 10:00 AM. We'll text you a confirmation shortly.");
  const sent = server.callsTo("/webhook/salon-booking")[0].body;
  assert.equal(sent.service_id, 5);
  assert.equal(sent.booking_date, OPEN_DAY);
  assert.equal(sent.start_time, "10:00");
  assert.equal(sent.phone, "09171234567");
  assert.deepEqual(page.errors, []);
});

test("a failed booking never shows the raw n8n error", { skip }, async () => {
  const state = freshState();
  state.webhook = () => ({ status: 500, body: { code: 0, message: "Error in workflow" } });
  await open(state);
  await fillBooking(5, OPEN_DAY);
  await page.click("#submit-btn");
  await page.waitFor(`document.getElementById("status").classList.contains("error")`);
  const text = await page.text("#status");
  assert.equal(text, "The booking didn't go through. Try again, or text us at 0917 555 1234.");
});

test("a refused booking shows the database message and reloads the times", { skip }, async () => {
  const state = freshState();
  state.webhook = () => ({ status: 200, body: { success: false, code: "slot_taken", message: "Sorry, everyone is booked at that time. Please choose another time." } });
  await open(state);
  await fillBooking(5, OPEN_DAY);
  const before = server.callsTo("/rest/v1/rpc/get_available_slots").length;
  await page.click("#submit-btn");
  await page.waitFor(`document.getElementById("status").classList.contains("error")`);
  assert.equal(await page.text("#status"), "Sorry, everyone is booked at that time. Please choose another time.");
  await page.waitFor(`true`);
  assert.ok(server.callsTo("/rest/v1/rpc/get_available_slots").length > before, "times reloaded");
});

test("when Supabase is down the built-in services and a text-us message show", { skip }, async () => {
  const state = freshState();
  state.fail = true;
  await open(state);
  assert.equal(await page.eval(`document.querySelectorAll("#services-grid .service-card").length`), 8);
  assert.equal(await page.text("#booking-unavailable"), "Online booking is unavailable right now. Text us at 0917 000 0000 to book.");
  assert.equal(await page.eval(`document.getElementById("booking-form")`), null);
  assert.deepEqual(page.errors, []);
});
