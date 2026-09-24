import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml, peso, timeToMinutes, minutesToTime, to12h, addDays, todayInManila,
  dateLabel, weekdayOf, normalizePhone, closedReasonFor, slotGrid, capacityBySlot,
  statusActions, bookingsOutsideRules, customerSummary, SOURCE_LABELS, STATUS_LABELS, ICONS,
  WEEKDAY_NAMES
} from "../admin/js/format.js";

test("escapeHtml escapes markup and quotes", () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(42), "42");
});

test("peso formats pesos with thousands separators", () => {
  assert.equal(peso(1800), "₱1,800");
  assert.equal(peso("450"), "₱450");
});

test("time helpers convert between text and minutes", () => {
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(timeToMinutes("09:30:00"), 570);
  assert.equal(minutesToTime(570), "09:30");
  assert.equal(to12h("14:30:00"), "2:30 PM");
  assert.equal(to12h("00:15"), "12:15 AM");
  assert.equal(to12h("12:00"), "12:00 PM");
});

test("date helpers work on YYYY-MM-DD text", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dateLabel("2026-09-24"), "Thu, Sep 24");
  assert.equal(weekdayOf("2026-09-27"), 0);
});

test("todayInManila uses the salon's timezone", () => {
  assert.equal(todayInManila(new Date("2026-09-24T17:00:00Z")), "2026-09-25");
  assert.equal(todayInManila(new Date("2026-09-24T15:59:00Z")), "2026-09-24");
});

test("normalizePhone accepts local and +63 numbers", () => {
  assert.equal(normalizePhone("0917 123 4567"), "09171234567");
  assert.equal(normalizePhone("+63 917-123-4567"), "09171234567");
  assert.equal(normalizePhone("12345"), null);
});

test("closedReasonFor matches the database messages", () => {
  const dates = [{ closed_on: "2026-12-25", reason: "Christmas" }, { closed_on: "2026-12-26", reason: null }];
  assert.equal(closedReasonFor("2026-09-27", [0], dates), "We're closed on Sundays.");
  assert.equal(closedReasonFor("2026-12-25", [], dates), "We're closed that day (Christmas).");
  assert.equal(closedReasonFor("2026-12-26", [], dates), "We're closed that day.");
  assert.equal(closedReasonFor("2026-09-28", [0], dates), null);
});

test("slotGrid lists start times before closing", () => {
  const grid = slotGrid("09:00:00", "18:00:00", 30);
  assert.equal(grid.length, 18);
  assert.equal(grid[0], "09:00");
  assert.equal(grid.at(-1), "17:30");
  assert.deepEqual(slotGrid("09:00", "11:00", 60), ["09:00", "10:00"]);
});

test("capacityBySlot counts active bookings per group in each slot", () => {
  const groups = [{ name: "hair", staff_count: 2 }, { name: "nails", staff_count: 1 }];
  const bookings = [
    { start_time: "10:00:00", duration_minutes: 45, staff_group: "nails", status: "confirmed" },
    { start_time: "10:00:00", duration_minutes: 30, staff_group: "nails", status: "pending" },
    { start_time: "10:00:00", duration_minutes: 60, staff_group: "hair", status: "cancelled" }
  ];
  const cap = capacityBySlot(bookings, groups, ["09:30", "10:00", "10:30", "11:00"], 30);
  const nails = (slot) => cap[slot].find((c) => c.group === "nails");
  const hair = (slot) => cap[slot].find((c) => c.group === "hair");
  assert.deepEqual(nails("10:00"), { group: "nails", used: 2, total: 1, over: true });
  assert.equal(nails("10:30").used, 1, "45-minute booking reaches into the 10:30 slot");
  assert.equal(nails("11:00").used, 0);
  assert.equal(nails("09:30").used, 0);
  assert.equal(hair("10:00").used, 0, "cancelled bookings do not count");
});

test("statusActions offers the next steps for each status", () => {
  assert.deepEqual(statusActions("pending").map((a) => a.status), ["confirmed", "cancelled"]);
  assert.deepEqual(statusActions("confirmed").map((a) => a.status), ["completed", "no_show", "cancelled"]);
  assert.deepEqual(statusActions("completed"), []);
  assert.deepEqual(statusActions("cancelled"), []);
  assert.deepEqual(statusActions("no_show"), []);
});

test("bookingsOutsideRules lists upcoming bookings the new hours would break", () => {
  const rules = { open_time: "10:00", close_time: "17:00", closed_weekdays: [0], closed_dates: [{ closed_on: "2026-10-01", reason: "Fiesta" }] };
  const bookings = [
    { id: "a", booking_date: "2026-09-28", start_time: "09:30:00", duration_minutes: 30, status: "confirmed" },
    { id: "b", booking_date: "2026-09-28", start_time: "16:30:00", duration_minutes: 60, status: "confirmed" },
    { id: "c", booking_date: "2026-09-27", start_time: "11:00:00", duration_minutes: 60, status: "pending" },
    { id: "d", booking_date: "2026-10-01", start_time: "11:00:00", duration_minutes: 60, status: "confirmed" },
    { id: "e", booking_date: "2026-09-28", start_time: "11:00:00", duration_minutes: 60, status: "confirmed" },
    { id: "f", booking_date: "2026-09-28", start_time: "08:00:00", duration_minutes: 60, status: "cancelled" }
  ];
  const found = bookingsOutsideRules(bookings, rules);
  assert.deepEqual(found.map((b) => b.id), ["a", "b", "c", "d"]);
  assert.equal(found[0].problem, "Starts before opening");
  assert.equal(found[1].problem, "Ends after closing");
  assert.equal(found[2].problem, "We're closed on Sundays.");
  assert.equal(found[3].problem, "We're closed that day (Fiesta).");
});

test("customerSummary counts visits and no-shows", () => {
  const summary = customerSummary([
    { booking_date: "2026-08-01", status: "completed" },
    { booking_date: "2026-09-01", status: "completed" },
    { booking_date: "2026-09-10", status: "no_show" },
    { booking_date: "2026-10-01", status: "confirmed" }
  ]);
  assert.deepEqual(summary, { completed: 2, noShows: 1, lastVisit: "2026-09-01" });
  assert.deepEqual(customerSummary([]), { completed: 0, noShows: 0, lastVisit: null });
});

test("labels cover every source, status, icon and weekday", () => {
  assert.deepEqual(Object.keys(SOURCE_LABELS), ["website", "ai_chat", "walk_in", "phone"]);
  assert.deepEqual(Object.keys(STATUS_LABELS), ["pending", "confirmed", "cancelled", "completed", "no_show"]);
  assert.deepEqual(ICONS.map((i) => i.id), ["i-scissors", "i-palette", "i-lines", "i-brush", "i-drop", "i-leaf"]);
  assert.equal(WEEKDAY_NAMES[0], "Sunday");
  assert.equal(WEEKDAY_NAMES.length, 7);
});

test("timeInManila gives the salon's current time", async () => {
  const { timeInManila } = await import("../admin/js/format.js");
  assert.equal(timeInManila(new Date("2026-09-24T06:07:00Z")), "14:07");
  assert.equal(timeInManila(new Date("2026-09-24T16:30:00Z")), "00:30");
});
