// One customer: details (editable), visit summary, upcoming and past bookings.
import { getCustomer, listCustomerBookings, updateCustomer } from "../db.js";
import { html, mount, toast, setBusy } from "../ui.js";
import { todayInManila, dateLabel, to12h, normalizePhone, customerSummary, STATUS_LABELS } from "../format.js";

const ACTIVE = new Set(["pending", "confirmed"]);

function historyItem(b) {
  return html`
    <a class="list-item list-link history-item" data-id="${b.booking_id}" href="#/schedule?date=${b.booking_date}">
      <span><strong>${dateLabel(b.booking_date)}, ${to12h(b.start_time)}</strong><br><span class="muted">${b.service_name}</span></span>
      <span class="badge status ${b.status}">${STATUS_LABELS[b.status]}</span>
    </a>`;
}

export async function render(root, { id, navigate }) {
  mount(root, html`<p class="muted">Loading...</p>`);
  const [customer, bookings] = await Promise.all([getCustomer(id), listCustomerBookings(id)]);
  const today = todayInManila();
  const upcoming = bookings
    .filter((b) => b.booking_date >= today && ACTIVE.has(b.status))
    .sort((a, b) => (a.booking_date + a.start_time).localeCompare(b.booking_date + b.start_time));
  const past = bookings.filter((b) => !upcoming.includes(b));
  const summary = customerSummary(bookings);

  mount(root, html`
    <div class="screen-head" data-screen="customer">
      <div>
        <a class="back-link" href="#/customers"><svg class="icon"><use href="#i-left"/></svg>Customers</a>
        <h1 id="customer-name">${customer.full_name}</h1>
      </div>
      <button type="button" class="btn btn-primary" id="book-again"><svg class="icon"><use href="#i-plus"/></svg>Book again</button>
    </div>

    <div class="stats">
      <div class="stat"><strong id="stat-completed">${summary.completed}</strong><span>Visits</span></div>
      <div class="stat"><strong id="stat-noshows">${summary.noShows}</strong><span>No-shows</span></div>
      <div class="stat"><strong id="stat-last">${summary.lastVisit ? dateLabel(summary.lastVisit) : "None yet"}</strong><span>Last visit</span></div>
    </div>

    <form id="customer-form" class="card" novalidate>
      <h2>Details</h2>
      <div class="row">
        <div class="field"><label class="field-label" for="cu-name">Name</label>
          <input type="text" id="cu-name" value="${customer.full_name}"></div>
        <div class="field"><label class="field-label" for="cu-phone">Mobile number</label>
          <input type="tel" id="cu-phone" value="${customer.phone}"></div>
      </div>
      <div class="field"><label class="field-label" for="cu-email">Email <span class="muted">(optional)</span></label>
        <input type="email" id="cu-email" value="${customer.email || ""}"></div>
      <label class="check field"><input type="checkbox" id="cu-sms"${customer.sms_opt_in ? " checked" : ""}> Agrees to text reminders</label>
      <p class="error-text" id="customer-error" role="alert"></p>
      <button type="submit" class="btn btn-primary" data-save>Save details</button>
    </form>

    <section id="upcoming">
      <h2>Upcoming</h2>
      ${upcoming.length ? html`<div class="list">${upcoming.map(historyItem)}</div>` : html`<p class="empty">No upcoming bookings.</p>`}
    </section>
    <section id="past">
      <h2>Past</h2>
      ${past.length ? html`<div class="list">${past.map(historyItem)}</div>` : html`<p class="empty">No past bookings.</p>`}
    </section>`);

  root.querySelector("#book-again").addEventListener("click", () => navigate("new", null, { customer: id }));

  const form = root.querySelector("#customer-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = root.querySelector("#customer-error");
    error.textContent = "";
    const fullName = root.querySelector("#cu-name").value.trim();
    const phone = normalizePhone(root.querySelector("#cu-phone").value);
    if (fullName.length < 2) { error.textContent = "Enter the customer's name."; return; }
    if (!phone) { error.textContent = "Enter an 11-digit mobile number starting with 09."; return; }
    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      await updateCustomer(id, {
        full_name: fullName, phone,
        email: root.querySelector("#cu-email").value.trim() || null,
        sms_opt_in: root.querySelector("#cu-sms").checked
      });
      root.querySelector("#customer-name").textContent = fullName;
      root.querySelector("#cu-phone").value = phone;
      toast("Customer saved");
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(button, false);
    }
  });
}
