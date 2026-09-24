// New booking: walk-ins and phone bookings, saved through create_booking so the
// same hours, closures and capacity rules apply as on the website.
import { getServices, getSettings, getCustomer, getAvailableSlots, createBooking, findCustomerByPhone } from "../db.js";
import { html, mount, toast, setBusy } from "../ui.js";
import { todayInManila, timeInManila, timeToMinutes, to12h, peso, normalizePhone } from "../format.js";

export async function render(root, { params, navigate }) {
  const today = todayInManila();
  mount(root, html`<p class="muted">Loading...</p>`);
  const [services, settings, prefill] = await Promise.all([
    getServices({ includeInactive: false }),
    getSettings(),
    params.customer ? getCustomer(params.customer).catch(() => null) : null
  ]);

  mount(root, html`
    <div class="screen-head" data-screen="new"><h1>New booking</h1></div>
    <form id="new-booking" class="card" novalidate>
      <fieldset class="field">
        <legend class="field-label">Booking type</legend>
        <div class="choice-row">
          <label class="choice"><input type="radio" name="source" value="walk_in" checked><span>Walk-in</span></label>
          <label class="choice"><input type="radio" name="source" value="phone"><span>Phone</span></label>
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">Service</legend>
        <div class="choice-row">
          ${services.map((s) => html`
            <label class="choice"><input type="radio" name="service" value="${s.id}">
              <span>${s.name} <small class="muted">${s.duration_minutes} min, ${peso(s.price)}</small></span></label>`)}
        </div>
        <p class="error-text" id="err-service"></p>
      </fieldset>
      <div class="row">
        <div class="field">
          <label class="field-label" for="nb-date">Date</label>
          <input type="date" id="nb-date" value="${today}" min="${today}">
          <p class="error-text" id="err-date"></p>
        </div>
        <div class="field">
          <label class="field-label" for="nb-time">Time</label>
          <select id="nb-time" disabled><option value="">Choose a service first</option></select>
          <p class="error-text" id="err-time"></p>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label class="field-label" for="nb-phone">Mobile number</label>
          <input type="tel" id="nb-phone" placeholder="09171234567" autocomplete="off" value="${prefill?.phone || ""}">
          <p class="error-text" id="err-phone"></p>
          <p class="ok-text" id="phone-found">${prefill ? `Existing customer: ${prefill.full_name}` : ""}</p>
        </div>
        <div class="field">
          <label class="field-label" for="nb-name">Name</label>
          <input type="text" id="nb-name" autocomplete="off" value="${prefill?.full_name || ""}">
          <p class="error-text" id="err-name"></p>
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="nb-email">Email <span class="muted">(optional)</span></label>
        <input type="email" id="nb-email" autocomplete="off" value="${prefill?.email || ""}">
      </div>
      <div class="field">
        <label class="field-label" for="nb-notes">Notes <span class="muted">(optional)</span></label>
        <textarea id="nb-notes"></textarea>
      </div>
      <label class="check field"><input type="checkbox" id="nb-sms"${prefill?.sms_opt_in ? " checked" : ""}> Customer agrees to text reminders</label>
      <p class="error-text" id="booking-error" role="alert"></p>
      <button type="submit" class="btn btn-primary" data-save>Save booking</button>
    </form>`);

  const $ = (id) => root.querySelector(`#${id}`);
  const form = $("new-booking");
  const setError = (id, text) => { $(id).textContent = text; };
  const source = () => form.querySelector('input[name="source"]:checked').value;
  const serviceId = () => Number(form.querySelector('input[name="service"]:checked')?.value) || null;
  let timesRequest = 0;

  function setTimes(times, placeholder = "Choose a time") {
    mount($("nb-time"), html`<option value="">${placeholder}</option>${times.map((t) => html`<option value="${t.time}">${t.label}</option>`)}`);
    $("nb-time").disabled = !times.length;
  }

  async function refreshTimes() {
    const request = ++timesRequest;
    const date = $("nb-date").value;
    setError("err-date", "");
    setError("err-time", "");
    if (!serviceId()) return setTimes([], "Choose a service first");
    if (!date) return setTimes([], "Choose a date first");
    setTimes([], "Loading times...");
    try {
      const r = await getAvailableSlots(date, serviceId());
      if (request !== timesRequest) return;
      if (!r.success) { setError("err-date", "Choose today or a later date."); return setTimes([], "No times"); }
      if (r.closed) { setError("err-date", r.closed_reason); return setTimes([], "Closed that day"); }
      const times = [...r.available_times];
      // A walk-in can start right now, even between slots.
      const now = timeInManila();
      const nowMinutes = timeToMinutes(now);
      if (source() === "walk_in" && date === today
          && nowMinutes >= timeToMinutes(settings.open_time) && nowMinutes < timeToMinutes(settings.close_time)) {
        times.unshift({ time: now, label: `Now (${to12h(now)})` });
      }
      if (!times.length) { setError("err-time", "No open times that day."); return setTimes([], "No open times"); }
      setTimes(times);
    } catch (err) {
      if (request !== timesRequest) return;
      setError("err-time", err.message);
      setTimes([], "No times");
    }
  }

  let lookedUp = prefill?.phone || null;
  async function lookUpPhone() {
    const phone = normalizePhone($("nb-phone").value);
    if (!phone || phone === lookedUp) return;
    lookedUp = phone;
    setError("err-phone", "");
    try {
      const customer = await findCustomerByPhone(phone);
      if (lookedUp !== phone) return;
      if (customer) {
        $("nb-name").value = customer.full_name;
        $("nb-email").value = customer.email || "";
        $("nb-sms").checked = customer.sms_opt_in;
        $("phone-found").textContent = `Existing customer: ${customer.full_name}`;
      } else {
        $("phone-found").textContent = "New customer";
      }
    } catch {
      $("phone-found").textContent = "";
    }
  }

  form.addEventListener("change", (e) => {
    if (e.target.name === "service" || e.target.name === "source" || e.target.id === "nb-date") {
      setError("err-service", "");
      refreshTimes();
    }
    if (e.target.id === "nb-phone") lookUpPhone();
  });
  $("nb-phone").addEventListener("input", lookUpPhone);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ["err-service", "err-time", "err-name", "err-phone", "booking-error"].forEach((id) => setError(id, ""));
    const phone = normalizePhone($("nb-phone").value);
    const name = $("nb-name").value.trim();
    let valid = true;
    if (!serviceId()) { setError("err-service", "Choose a service."); valid = false; }
    if (!$("nb-time").value) { setError("err-time", "Choose a time."); valid = false; }
    if (name.length < 2) { setError("err-name", "Enter the customer's name."); valid = false; }
    if (!phone) { setError("err-phone", "Enter an 11-digit mobile number starting with 09."); valid = false; }
    if (!valid) return;

    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      const r = await createBooking({
        full_name: name, phone, email: $("nb-email").value.trim(), service_id: serviceId(),
        booking_date: $("nb-date").value, start_time: $("nb-time").value,
        notes: $("nb-notes").value.trim(), sms_opt_in: $("nb-sms").checked, source: source()
      });
      if (!r.success) {
        setError("booking-error", r.message);
        if (r.code === "slot_taken" || r.code === "closed") refreshTimes();
        setBusy(button, false);
        return;
      }
      toast("Booking saved");
      navigate("schedule", null, { date: $("nb-date").value });
    } catch (err) {
      setError("booking-error", err.message);
      setBusy(button, false);
    }
  });

  if (params.service) {
    const radio = form.querySelector(`input[name="service"][value="${CSS.escape(params.service)}"]`);
    if (radio) radio.checked = true;
  }
  refreshTimes();
}
