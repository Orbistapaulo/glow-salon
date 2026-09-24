// Services (owner): add, edit, hide, reorder; and staff groups with their staff counts.
import { getServices, getStaffGroups, listUpcomingBookings, saveService, swapServiceOrder, saveStaffGroup } from "../db.js";
import { html, mount, toast, confirmDialog, setBusy } from "../ui.js";
import { todayInManila, peso, ICONS } from "../format.js";

const groupLabel = (name) => name.charAt(0).toUpperCase() + name.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function render(root) {
  mount(root, html`<p class="muted">Loading services...</p>`);
  const [services, groups, upcoming] = await Promise.all([
    getServices(), getStaffGroups(), listUpcomingBookings(todayInManila())
  ]);
  let editing = null; // the service being edited, or {} for a new one

  function serviceForm(s) {
    const isNew = !s.id;
    return html`
      <form id="service-form" class="card" novalidate>
        <h2>${isNew ? "New service" : `Edit ${s.name}`}</h2>
        <div class="field"><label class="field-label" for="sv-name">Name</label>
          <input type="text" id="sv-name" value="${s.name || ""}"></div>
        <div class="field"><label class="field-label" for="sv-description">Short description <span class="muted">(shown on the website)</span></label>
          <input type="text" id="sv-description" value="${s.description || ""}"></div>
        <fieldset class="field"><legend class="field-label">Icon</legend>
          <div class="choice-row">
            ${ICONS.map((icon, i) => html`
              <label class="choice"><input type="radio" name="sv-icon" value="${icon.id}"${(s.icon || "i-scissors") === icon.id ? " checked" : ""}>
                <span><svg class="icon" aria-hidden="true"><use href="#${icon.id}"/></svg>${icon.label}</span></label>`)}
          </div>
        </fieldset>
        <div class="row">
          <div class="field"><label class="field-label" for="sv-duration">Minutes</label>
            <input type="number" id="sv-duration" min="5" step="5" value="${s.duration_minutes ?? ""}"></div>
          <div class="field"><label class="field-label" for="sv-price">Price (₱)</label>
            <input type="number" id="sv-price" min="0" step="1" value="${s.price ?? ""}"></div>
        </div>
        <div class="field"><label class="field-label" for="sv-group">Staff group</label>
          <select id="sv-group">${groups.map((g) => html`<option value="${g.name}"${s.staff_group === g.name ? " selected" : ""}>${groupLabel(g.name)}</option>`)}</select></div>
        <label class="check field"><input type="checkbox" id="sv-active"${s.is_active !== false ? " checked" : ""}> Show on the website</label>
        <p class="error-text" id="sv-error" role="alert"></p>
        <div class="actions">
          <button type="submit" class="btn btn-primary" data-save>Save service</button>
          <button type="button" class="btn btn-ghost" id="cancel-edit">Cancel</button>
        </div>
      </form>`;
  }

  function serviceRow(s, i) {
    return html`
      <article class="list-item service-row${s.is_active ? "" : " dim"}" data-id="${s.id}">
        <div class="service-line">
          <span class="service-icon"><svg class="icon" aria-hidden="true"><use href="#${s.icon}"/></svg></span>
          <div class="service-text">
            <h3>${s.name}</h3>
            <p class="service-summary muted">${s.duration_minutes} min, ${peso(s.price)}, ${groupLabel(s.staff_group)}</p>
          </div>
          ${s.is_active ? "" : html`<span class="badge">Hidden</span>`}
        </div>
        <div class="service-actions">
          <button type="button" class="icon-btn" data-move="up" aria-label="Move ${s.name} up"${i === 0 ? " disabled" : ""}><svg class="icon"><use href="#i-up"/></svg></button>
          <button type="button" class="icon-btn" data-move="down" aria-label="Move ${s.name} down"${i === services.length - 1 ? " disabled" : ""}><svg class="icon"><use href="#i-down"/></svg></button>
          <button type="button" class="btn btn-ghost btn-small" data-edit>Edit</button>
          <button type="button" class="btn btn-ghost btn-small" data-toggle data-save>${s.is_active ? "Hide" : "Show"}</button>
        </div>
      </article>`;
  }

  function draw() {
    services.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    mount(root, html`
      <div class="screen-head" data-screen="services">
        <h1>Services</h1>
        <button type="button" class="btn btn-primary" id="add-service"><svg class="icon"><use href="#i-plus"/></svg>Add service</button>
      </div>
      ${editing ? serviceForm(editing) : ""}
      <div class="list">${services.map(serviceRow)}</div>
      <section class="card" id="groups">
        <h2>Staff groups</h2>
        <p class="muted">How many people can do each kind of service at the same time.</p>
        <div class="list">
          ${groups.map((g) => html`
            <div class="group-row" data-name="${g.name}">
              <label class="group-name" for="group-${g.name}">${groupLabel(g.name)}</label>
              <input type="number" id="group-${g.name}" min="0" max="50" value="${g.staff_count}">
              <button type="button" class="btn btn-ghost btn-small" data-save-group data-save>Save</button>
            </div>`)}
        </div>
        <div class="group-add">
          <input type="text" id="new-group-name" placeholder="New group, for example lashes" aria-label="New group name">
          <input type="number" id="new-group-count" min="0" max="50" value="1" aria-label="Staff in the new group">
          <button type="button" class="btn btn-ghost btn-small" id="add-group" data-save>Add group</button>
        </div>
        <p class="error-text" id="group-error" role="alert"></p>
      </section>`);
    if (editing) root.querySelector("#sv-name").focus();
  }

  async function submitService(form) {
    const error = root.querySelector("#sv-error");
    const name = root.querySelector("#sv-name").value.trim();
    const duration = Number(root.querySelector("#sv-duration").value);
    const priceText = root.querySelector("#sv-price").value;
    const price = Number(priceText);
    if (!name || !Number.isInteger(duration) || duration <= 0 || priceText === "" || !(price >= 0)) {
      error.textContent = "Enter a name, a duration above 0 minutes, and a price of 0 or more.";
      return;
    }
    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      const saved = await saveService({
        id: editing.id,
        name,
        description: root.querySelector("#sv-description").value.trim() || null,
        icon: root.querySelector('input[name="sv-icon"]:checked').value,
        duration_minutes: duration,
        price,
        staff_group: root.querySelector("#sv-group").value,
        is_active: root.querySelector("#sv-active").checked,
        sort_order: editing.id ? editing.sort_order : Math.max(0, ...services.map((s) => s.sort_order)) + 1
      });
      const i = services.findIndex((s) => s.id === saved.id);
      if (i >= 0) services[i] = saved; else services.push(saved);
      editing = null;
      draw();
      toast("Service saved");
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false);
    }
  }

  async function toggle(service, button) {
    const hiding = service.is_active;
    if (hiding) {
      const count = upcoming.filter((b) => b.service_id === service.id).length;
      if (count) {
        const ok = await confirmDialog(
          `${service.name} has ${plural(count, "upcoming booking")}. Hide it from the website anyway? Those bookings stay.`, "Hide service");
        if (!ok) return;
      }
    }
    setBusy(button, true);
    try {
      const saved = await saveService({ ...service, is_active: !hiding });
      Object.assign(service, saved);
      draw();
      toast(hiding ? "Service hidden" : "Service shown");
    } catch (err) {
      setBusy(button, false);
      toast(err.message, "error");
    }
  }

  async function move(service, direction) {
    const i = services.indexOf(service);
    const other = services[direction === "up" ? i - 1 : i + 1];
    if (!other) return;
    // Equal positions (e.g. two new services) would not swap, so separate them first.
    const a = { ...service }, b = { ...other };
    if (a.sort_order === b.sort_order) b.sort_order = a.sort_order + (direction === "down" ? 1 : -1);
    try {
      await swapServiceOrder(a, b);
      service.sort_order = b.sort_order;
      other.sort_order = a.sort_order;
      draw();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function saveGroupCount(row, button) {
    const error = root.querySelector("#group-error");
    error.textContent = "";
    const count = Number(row.querySelector("input").value);
    if (!Number.isInteger(count) || count < 0) { error.textContent = "Staff count must be 0 or more."; return; }
    setBusy(button, true);
    try {
      await saveStaffGroup({ name: row.dataset.name, staff_count: count }, false);
      groups.find((g) => g.name === row.dataset.name).staff_count = count;
      toast("Staff count saved");
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function addGroup(button) {
    const error = root.querySelector("#group-error");
    error.textContent = "";
    const name = root.querySelector("#new-group-name").value.trim().toLowerCase();
    const count = Number(root.querySelector("#new-group-count").value);
    if (!name) { error.textContent = "Enter a name for the group."; return; }
    if (groups.some((g) => g.name === name)) { error.textContent = "A group with that name already exists."; return; }
    if (!Number.isInteger(count) || count < 0) { error.textContent = "Staff count must be 0 or more."; return; }
    setBusy(button, true);
    try {
      const saved = await saveStaffGroup({ name, staff_count: count }, true);
      groups.push(saved);
      groups.sort((a, b) => a.name.localeCompare(b.name));
      draw();
      toast("Group added");
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false);
    }
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#add-service")) { editing = {}; return draw(); }
    if (t.closest("#cancel-edit")) { editing = null; return draw(); }
    if (t.closest("#add-group")) return addGroup(t.closest("#add-group"));
    const groupButton = t.closest("[data-save-group]");
    if (groupButton) return saveGroupCount(groupButton.closest(".group-row"), groupButton);

    const row = t.closest(".service-row");
    if (!row) return;
    const service = services.find((s) => String(s.id) === row.dataset.id);
    if (t.closest("[data-edit]")) { editing = service; draw(); root.scrollIntoView({ block: "start" }); return; }
    if (t.closest("[data-toggle]")) return toggle(service, t.closest("[data-toggle]"));
    const moveButton = t.closest("[data-move]");
    if (moveButton) return move(service, moveButton.dataset.move);
  });

  root.addEventListener("submit", (e) => {
    if (e.target.id !== "service-form") return;
    e.preventDefault();
    submitService(e.target);
  });

  draw();
}
