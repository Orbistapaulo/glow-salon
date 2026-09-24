// Schedule: one day's bookings, status buttons, notes, and how busy each group is.
import { listDayBookings, getStaffGroups, getSettings, setBookingStatus, setBookingNotes } from "../db.js";
import { html, mount, toast, confirmDialog, setBusy } from "../ui.js";
import {
  todayInManila, addDays, dateLabel, to12h, slotGrid, capacityBySlot, statusActions,
  SOURCE_LABELS, STATUS_LABELS
} from "../format.js";

const groupLabel = (name) => name.charAt(0).toUpperCase() + name.slice(1);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

export async function render(root, { params, navigate }) {
  const today = todayInManila();
  const date = isDate(params.date) ? params.date : today;
  mount(root, html`<p class="muted">Loading the schedule...</p>`);
  const [bookings, groups, settings] = await Promise.all([listDayBookings(date), getStaffGroups(), getSettings()]);

  function bookingRow(b) {
    const actions = statusActions(b.status);
    return html`
      <article class="list-item booking${actions.length ? "" : " dim"}" data-id="${b.booking_id}">
        <div class="booking-top">
          <p class="booking-time"><strong>${to12h(b.start_time)}</strong> to ${to12h(b.end_time)}</p>
          <span class="badge status ${b.status}">${STATUS_LABELS[b.status]}</span>
        </div>
        <h3 class="booking-name"><a href="#/customers/${encodeURIComponent(b.customer_id)}">${b.customer_name}</a></h3>
        <p class="booking-meta">
          <span class="booking-service">${b.service_name}</span>
          <span class="badge source">${SOURCE_LABELS[b.source] || b.source}</span>
        </p>
        <p class="booking-contact">
          <a class="btn btn-ghost btn-small" href="tel:${b.customer_phone}"><svg class="icon"><use href="#i-phone"/></svg>${b.customer_phone}</a>
          <a class="btn btn-ghost btn-small" href="sms:${b.customer_phone}"><svg class="icon"><use href="#i-message"/></svg>Text</a>
        </p>
        ${actions.length ? html`
          <div class="booking-actions">
            ${actions.map((a) => html`
              <button type="button" class="btn btn-small ${a.status === "cancelled" ? "btn-ghost" : "btn-primary"}"
                      data-status="${a.status}" data-save>${a.label}</button>`)}
          </div>` : ""}
        <details class="booking-notes"${b.notes ? " open" : ""}>
          <summary>Notes</summary>
          <textarea aria-label="Notes for ${b.customer_name}">${b.notes || ""}</textarea>
          <button type="button" class="btn btn-ghost btn-small" data-save-notes data-save>Save notes</button>
        </details>
      </article>`;
  }

  function busyStrip() {
    const cap = capacityBySlot(bookings, groups, slotGrid(settings.open_time, settings.close_time, settings.slot_minutes), settings.slot_minutes);
    const busy = Object.entries(cap)
      .map(([slot, list]) => ({ slot, list: list.filter((c) => c.used > 0) }))
      .filter((s) => s.list.length);
    if (!busy.length) return "";
    return html`
      <div class="capacity" aria-label="How busy each time is">
        ${busy.map((s) => html`
          <div class="cap-slot${s.list.some((c) => c.over) ? " over" : ""}" data-slot="${s.slot}">
            <strong>${to12h(s.slot)}</strong>
            ${s.list.map((c) => html` <span class="cap${c.over ? " over" : ""}">${groupLabel(c.group)} ${c.used}/${c.total}</span>`)}
          </div>`)}
      </div>`;
  }

  function draw() {
    mount(root, html`
      <div class="screen-head" id="schedule" data-screen="schedule">
        <h1>${dateLabel(date)}${date === today ? " (today)" : ""}</h1>
        <div class="day-picker">
          <button type="button" class="icon-btn" id="prev-day" aria-label="Previous day"><svg class="icon"><use href="#i-left"/></svg></button>
          <button type="button" class="btn btn-ghost btn-small" id="today">Today</button>
          <input type="date" id="pick-day" value="${date}" aria-label="Pick a day">
          <button type="button" class="icon-btn" id="next-day" aria-label="Next day"><svg class="icon"><use href="#i-right"/></svg></button>
        </div>
      </div>
      ${busyStrip()}
      ${bookings.length
        ? html`<div class="list">${bookings.map(bookingRow)}</div>`
        : html`<p class="empty">No bookings on this day.</p>`}`);
  }

  draw();

  const goTo = (d) => navigate("schedule", null, { date: d });
  root.addEventListener("click", async (e) => {
    if (e.target.closest("#prev-day")) return goTo(addDays(date, -1));
    if (e.target.closest("#next-day")) return goTo(addDays(date, 1));
    if (e.target.closest("#today")) return goTo(today);

    const card = e.target.closest(".booking");
    if (!card) return;
    const booking = bookings.find((b) => b.booking_id === card.dataset.id);

    const statusButton = e.target.closest("[data-status]");
    if (statusButton) {
      const status = statusButton.dataset.status;
      if (status === "cancelled") {
        const ok = await confirmDialog(
          `Cancel ${booking.service_name} for ${booking.customer_name} at ${to12h(booking.start_time)}?`, "Cancel booking");
        if (!ok) return;
      }
      setBusy(statusButton, true);
      try {
        await setBookingStatus(booking.booking_id, status);
        booking.status = status;
        draw();
        toast(`Marked ${STATUS_LABELS[status].toLowerCase()}`);
      } catch (err) {
        setBusy(statusButton, false);
        toast(err.message, "error");
      }
      return;
    }

    const notesButton = e.target.closest("[data-save-notes]");
    if (notesButton) {
      const notes = card.querySelector("textarea").value.trim();
      setBusy(notesButton, true);
      try {
        await setBookingNotes(booking.booking_id, notes);
        booking.notes = notes || null;
        toast("Notes saved");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        setBusy(notesButton, false);
      }
    }
  });

  root.addEventListener("change", (e) => {
    if (e.target.id === "pick-day" && isDate(e.target.value)) goTo(e.target.value);
  });
}
