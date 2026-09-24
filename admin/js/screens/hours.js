// Hours and closures (owner). Changes that clash with upcoming bookings are listed
// first and only saved after "Save anyway". Nothing is cancelled automatically.
import { getSettings, getClosedDates, listUpcomingBookings, saveSettings, addClosedDate, removeClosedDate } from "../db.js";
import { html, mount, toast, setBusy } from "../ui.js";
import { todayInManila, dateLabel, to12h, timeToMinutes, bookingsOutsideRules, WEEKDAY_NAMES } from "../format.js";

const hhmm = (time) => String(time).slice(0, 5);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function render(root) {
  const today = todayInManila();
  mount(root, html`<p class="muted">Loading...</p>`);
  const [settings, closedDates, upcoming] = await Promise.all([
    getSettings(), getClosedDates(today), listUpcomingBookings(today)
  ]);

  mount(root, html`
    <div class="screen-head" data-screen="hours"><h1>Hours and closures</h1></div>
    <div id="clash"></div>

    <form id="hours-form" class="card" novalidate>
      <h2>Opening hours</h2>
      <div class="row">
        <div class="field"><label class="field-label" for="hr-open">Opens</label>
          <input type="time" id="hr-open" value="${hhmm(settings.open_time)}"></div>
        <div class="field"><label class="field-label" for="hr-close">Closes</label>
          <input type="time" id="hr-close" value="${hhmm(settings.close_time)}"></div>
      </div>
      <div class="field"><label class="field-label" for="hr-slot">Start times every</label>
        <select id="hr-slot">${[15, 30, 45, 60].map((m) => html`<option value="${m}"${settings.slot_minutes === m ? " selected" : ""}>${m} minutes</option>`)}</select></div>
      <fieldset class="field"><legend class="field-label">Closed every</legend>
        <div class="choice-row">
          ${WEEKDAY_NAMES.map((day, i) => html`
            <label class="choice"><input type="checkbox" name="hr-closed" value="${i}"${settings.closed_weekdays.includes(i) ? " checked" : ""}><span>${day}</span></label>`)}
        </div>
      </fieldset>
      <div class="row">
        <div class="field"><label class="field-label" for="hr-name">Salon name</label>
          <input type="text" id="hr-name" value="${settings.salon_name}"></div>
        <div class="field"><label class="field-label" for="hr-phone">Salon phone <span class="muted">(shown to customers)</span></label>
          <input type="tel" id="hr-phone" value="${settings.salon_phone}"></div>
      </div>
      <p class="error-text" id="hr-error" role="alert"></p>
      <button type="submit" class="btn btn-primary" data-save>Save hours</button>
    </form>

    <section class="card" id="closures">
      <h2>Closed dates</h2>
      <form id="closure-form" class="closure-add" novalidate>
        <input type="date" id="cl-date" min="${today}" aria-label="Closed date">
        <input type="text" id="cl-reason" placeholder="Reason, for example Holiday" aria-label="Reason">
        <button type="submit" class="btn btn-ghost" data-save>Add closed date</button>
      </form>
      <p class="error-text" id="cl-error" role="alert"></p>
      <div id="closure-list"></div>
    </section>`);

  const $ = (id) => root.querySelector(`#${id}`);

  function drawClosures() {
    closedDates.sort((a, b) => a.closed_on.localeCompare(b.closed_on));
    mount($("closure-list"), closedDates.length
      ? html`<ul class="list">${closedDates.map((c) => html`
          <li class="list-item closure-row" data-date="${c.closed_on}">
            <span><strong>${dateLabel(c.closed_on)}</strong>${c.reason ? html` <span class="muted">${c.reason}</span>` : ""}</span>
            <button type="button" class="btn btn-ghost btn-small" data-remove data-save>Remove</button>
          </li>`)}</ul>`
      : html`<p class="empty">No upcoming closed dates.</p>`);
  }

  function clearClash() { mount($("clash"), ""); }

  // Shows the affected bookings; the change runs only if the owner confirms.
  function showClash(clashes, run) {
    mount($("clash"), html`
      <section class="card warn-card" role="alert">
        <h2>${plural(clashes.length, "upcoming booking")} would be affected</h2>
        <p>Nothing is cancelled automatically. Contact these customers, or save anyway and sort them out on the schedule.</p>
        <ul id="clash-list">
          ${clashes.map((b) => html`
            <li data-id="${b.booking_id}"><strong>${dateLabel(b.booking_date)}, ${to12h(b.start_time)}</strong>
              ${b.customer_name}, ${b.service_name}: <span class="problem">${b.problem}</span></li>`)}
        </ul>
        <div class="actions">
          <button type="button" class="btn btn-danger" id="save-anyway" data-save>Save anyway</button>
          <button type="button" class="btn btn-ghost" id="clash-back">Go back</button>
        </div>
      </section>`);
    $("clash").scrollIntoView({ block: "start" });
    $("save-anyway").addEventListener("click", async (e) => {
      setBusy(e.target, true);
      if (await run()) clearClash(); else setBusy(e.target, false);
    });
    $("clash-back").addEventListener("click", clearClash);
  }

  async function saveHours(fields) {
    try {
      Object.assign(settings, await saveSettings(fields));
      toast("Hours saved");
      return true;
    } catch (err) {
      $("hr-error").textContent = err.message;
      return false;
    }
  }

  $("hours-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearClash();
    $("hr-error").textContent = "";
    const fields = {
      open_time: $("hr-open").value,
      close_time: $("hr-close").value,
      slot_minutes: Number($("hr-slot").value),
      closed_weekdays: [...root.querySelectorAll('input[name="hr-closed"]:checked')].map((c) => Number(c.value)),
      salon_name: $("hr-name").value.trim(),
      salon_phone: $("hr-phone").value.trim()
    };
    if (!fields.open_time || !fields.close_time) { $("hr-error").textContent = "Enter opening and closing times."; return; }
    if (timeToMinutes(fields.close_time) <= timeToMinutes(fields.open_time)) {
      $("hr-error").textContent = "Closing time must be after opening time.";
      return;
    }
    if (!fields.salon_name || !fields.salon_phone) { $("hr-error").textContent = "Enter the salon's name and phone number."; return; }

    const clashes = bookingsOutsideRules(upcoming, { ...fields, closed_dates: closedDates });
    if (clashes.length) return showClash(clashes, () => saveHours(fields));
    const button = e.target.querySelector("[type=submit]");
    setBusy(button, true);
    await saveHours(fields);
    setBusy(button, false);
  });

  async function addClosure(date, reason) {
    try {
      const saved = await addClosedDate(date, reason);
      closedDates.push(saved);
      drawClosures();
      $("cl-date").value = "";
      $("cl-reason").value = "";
      toast("Closed date added");
      return true;
    } catch (err) {
      $("cl-error").textContent = err.message;
      return false;
    }
  }

  $("closure-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearClash();
    $("cl-error").textContent = "";
    const date = $("cl-date").value;
    const reason = $("cl-reason").value.trim();
    if (!date || date < today) { $("cl-error").textContent = "Choose today or a later date."; return; }
    if (closedDates.some((c) => c.closed_on === date)) { $("cl-error").textContent = "That date is already marked as closed."; return; }
    const clashes = bookingsOutsideRules(upcoming.filter((b) => b.booking_date === date), {
      open_time: settings.open_time, close_time: settings.close_time,
      closed_weekdays: settings.closed_weekdays, closed_dates: [{ closed_on: date, reason }]
    });
    if (clashes.length) return showClash(clashes, () => addClosure(date, reason));
    const button = e.target.querySelector("[type=submit]");
    setBusy(button, true);
    await addClosure(date, reason);
    setBusy(button, false);
  });

  $("closure-list").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-remove]");
    if (!button) return;
    const date = button.closest(".closure-row").dataset.date;
    setBusy(button, true);
    try {
      await removeClosedDate(date);
      closedDates.splice(closedDates.findIndex((c) => c.closed_on === date), 1);
      drawClosures();
      toast("Closed date removed");
    } catch (err) {
      setBusy(button, false);
      toast(err.message, "error");
    }
  });

  drawClosures();
}
