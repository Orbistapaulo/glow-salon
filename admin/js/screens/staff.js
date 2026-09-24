// Staff logins (owner): approve people as staff or remove their access.
import { listStaffProfiles, setStaffRole } from "../db.js";
import { html, mount, toast } from "../ui.js";

const ROLES = [["none", "No access"], ["staff", "Staff"]];

export async function render(root, { profile }) {
  mount(root, html`<p class="muted">Loading...</p>`);
  const profiles = await listStaffProfiles();

  mount(root, html`
    <div class="screen-head" data-screen="staff"><h1>Staff logins</h1></div>
    <section class="card">
      <h2>Adding someone</h2>
      <p>Invite them from Supabase: open <a href="https://supabase.com/dashboard/project/_/auth/users" target="_blank" rel="noopener">Authentication, then Users</a>,
        choose <strong>Invite user</strong> and enter their email. Once they have set a password and signed in here,
        they appear below with no access. Choose Staff to let them in.</p>
    </section>
    <div class="list">
      ${profiles.map((p) => html`
        <div class="list-item staff-row" data-id="${p.user_id}">
          <div><strong>${p.full_name || p.email}</strong><br><span class="muted">${p.email}</span></div>
          ${p.user_id === profile.user_id
            ? html`<span class="badge">Owner (you)</span>`
            : p.role === "owner"
              ? html`<span class="badge">Owner</span>`
              : html`
                <label class="sr-only" for="role-${p.user_id}">Access for ${p.email}</label>
                <select id="role-${p.user_id}" data-role>
                  ${ROLES.map(([value, label]) => html`<option value="${value}"${p.role === value ? " selected" : ""}>${label}</option>`)}
                </select>`}
        </div>`)}
    </div>`);

  root.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-role]");
    if (!select) return;
    const person = profiles.find((p) => p.user_id === select.closest(".staff-row").dataset.id);
    const previous = person.role;
    select.disabled = true;
    try {
      await setStaffRole(person.user_id, select.value);
      person.role = select.value;
      toast("Access updated");
    } catch (err) {
      select.value = previous;
      toast(err.message, "error");
    } finally {
      select.disabled = false;
    }
  });
}
