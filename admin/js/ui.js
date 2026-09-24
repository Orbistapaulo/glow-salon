// Small DOM helpers. The html`` template escapes every value unless it is another
// html`` result or raw(), so text from the database can never become markup.
import { escapeHtml } from "./format.js";

const RAW = Symbol("raw");

export function raw(markup) {
  return { [RAW]: String(markup) };
}

function part(value) {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(part).join("");
  if (typeof value === "object" && RAW in value) return value[RAW];
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += part(value) + strings[i + 1]; });
  return raw(out);
}

export const toHtml = (markup) => part(markup);

export function mount(el, markup) {
  el.innerHTML = toHtml(markup);
}

export function toast(message, type = "ok") {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.className = `toast show ${type}`;
  clearTimeout(box.hideTimer);
  box.hideTimer = setTimeout(() => { box.className = "toast"; }, 3500);
}

export function confirmDialog(message, confirmLabel = "Yes") {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    mount(dialog, html`
      <p>${message}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" value="no">Go back</button>
        <button type="button" class="btn btn-danger" value="yes" id="confirm-yes">${confirmLabel}</button>
      </div>`);
    dialog.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (button) dialog.close(button.value);
    });
    dialog.addEventListener("close", () => { resolve(dialog.returnValue === "yes"); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function setBusy(button, busy, busyLabel = "Saving...") {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

// Offline banner; buttons marked data-save are paused while offline (see admin.css).
export function watchConnection() {
  const update = () => {
    const offline = !navigator.onLine;
    document.body.classList.toggle("is-offline", offline);
    document.getElementById("offline").hidden = !offline;
  };
  addEventListener("online", update);
  addEventListener("offline", update);
  update();
}
