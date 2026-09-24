// Pure helpers shared by the CRM screens: no DOM, no network. Tested in tests/format.test.mjs.

export const SOURCE_LABELS = { website: "Website", ai_chat: "Chat", walk_in: "Walk-in", phone: "Phone" };

export const STATUS_LABELS = {
  pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed", no_show: "No-show"
};

export const ICONS = [
  { id: "i-scissors", label: "Scissors" },
  { id: "i-palette", label: "Color" },
  { id: "i-lines", label: "Straight hair" },
  { id: "i-brush", label: "Nail brush" },
  { id: "i-drop", label: "Water drop" },
  { id: "i-leaf", label: "Leaf" }
];

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ACTIVE = new Set(["pending", "confirmed"]);
const pad = (n) => String(n).padStart(2, "0");

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function peso(n) {
  return "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

export function timeToMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function to12h(time) {
  const total = timeToMinutes(time);
  const h = Math.floor(total / 60), m = total % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

function parseDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, days) {
  const dt = parseDate(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function todayInManila(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function timeInManila(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function dateLabel(date) {
  return parseDate(date).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function weekdayOf(date) {
  return parseDate(date).getUTCDay();
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return "0" + digits.slice(2);
  return null;
}

// Phone-like searches become the digits stored in the database (09...).
export function customerSearchTerm(q) {
  const text = String(q || "").trim();
  if (!/^[\d\s+()-]+$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  return digits.startsWith("63") ? "0" + digits.slice(2) : digits;
}

// Same rule and wording as closed_reason() in the database.
export function closedReasonFor(date, closedWeekdays = [], closedDates = []) {
  const closure = closedDates.find((c) => c.closed_on === date);
  if (closure) {
    const reason = (closure.reason || "").trim();
    return reason ? `We're closed that day (${reason}).` : "We're closed that day.";
  }
  if (closedWeekdays.includes(weekdayOf(date))) return `We're closed on ${WEEKDAY_NAMES[weekdayOf(date)]}s.`;
  return null;
}

export function slotGrid(openTime, closeTime, slotMinutes) {
  const slots = [];
  for (let t = timeToMinutes(openTime); t < timeToMinutes(closeTime); t += slotMinutes) slots.push(minutesToTime(t));
  return slots;
}

// For each slot, how many active bookings of each staff group overlap it.
export function capacityBySlot(bookings, groups, slots, slotMinutes) {
  const active = bookings.filter((b) => ACTIVE.has(b.status));
  const result = {};
  for (const slot of slots) {
    const from = timeToMinutes(slot), to = from + slotMinutes;
    result[slot] = groups.map((g) => {
      const used = active.filter((b) => {
        if (b.staff_group !== g.name) return false;
        const start = timeToMinutes(b.start_time);
        return start < to && start + b.duration_minutes > from;
      }).length;
      return { group: g.name, used, total: g.staff_count, over: used > g.staff_count };
    });
  }
  return result;
}

export function statusActions(status) {
  if (status === "pending") return [{ status: "confirmed", label: "Confirm" }, { status: "cancelled", label: "Cancel" }];
  if (status === "confirmed") {
    return [
      { status: "completed", label: "Completed" },
      { status: "no_show", label: "No-show" },
      { status: "cancelled", label: "Cancel" }
    ];
  }
  return [];
}

// Upcoming bookings that would break new hours or closures, each with the problem.
export function bookingsOutsideRules(bookings, rules) {
  const open = timeToMinutes(rules.open_time), close = timeToMinutes(rules.close_time);
  const found = [];
  for (const b of bookings) {
    if (!ACTIVE.has(b.status)) continue;
    const start = timeToMinutes(b.start_time);
    const closed = closedReasonFor(b.booking_date, rules.closed_weekdays, rules.closed_dates);
    let problem = null;
    if (closed) problem = closed;
    else if (start < open) problem = "Starts before opening";
    else if (start + b.duration_minutes > close) problem = "Ends after closing";
    if (problem) found.push({ ...b, problem });
  }
  return found;
}

export function customerSummary(bookings) {
  const completed = bookings.filter((b) => b.status === "completed");
  const lastVisit = completed.reduce((last, b) => (last && last > b.booking_date ? last : b.booking_date), null);
  return {
    completed: completed.length,
    noShows: bookings.filter((b) => b.status === "no_show").length,
    lastVisit
  };
}
