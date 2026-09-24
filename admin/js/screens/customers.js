// Customers: search by name or phone.
import { searchCustomers } from "../db.js";
import { html, mount } from "../ui.js";
import { customerSearchTerm } from "../format.js";

export async function render(root) {
  mount(root, html`
    <div class="screen-head" data-screen="customers"><h1>Customers</h1></div>
    <label class="search">
      <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
      <input type="search" id="customer-search" placeholder="Search by name or phone" aria-label="Search customers" autocomplete="off">
    </label>
    <div id="customer-results"><p class="muted">Loading...</p></div>`);

  const results = root.querySelector("#customer-results");
  let request = 0;
  let timer;

  async function load(q) {
    const current = ++request;
    const term = customerSearchTerm(q);
    try {
      const list = await searchCustomers(term);
      if (current !== request) return;
      mount(results, list.length
        ? html`<div class="list">${list.map((c) => html`
            <a class="list-item list-link customer-row" data-id="${c.id}" href="#/customers/${encodeURIComponent(c.id)}">
              <span><strong>${c.full_name}</strong><br><span class="muted">${c.phone}</span></span>
              <svg class="icon" aria-hidden="true"><use href="#i-right"/></svg>
            </a>`)}</div>`
        : html`<p class="empty">${term ? "No customers match that search." : "No customers yet."}</p>`);
    } catch (err) {
      if (current === request) mount(results, html`<p class="error-text">${err.message}</p>`);
    }
  }

  root.querySelector("#customer-search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value), 250);
  });
  await load("");
}
