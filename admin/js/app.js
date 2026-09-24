// CRM entry point: login state, role checks, navigation and screen loading.
import { configured, supabase, getMyProfile, signOut } from "./db.js";
import { html, raw, mount, watchConnection } from "./ui.js";
import { parseRoute, buildHash, allowedRoute } from "./router.js";

const root = document.getElementById("app");

const SCREENS = {
  schedule: () => import("./screens/schedule.js"),
  new: () => import("./screens/new-booking.js"),
  customers: () => import("./screens/customers.js"),
  customer: () => import("./screens/customer.js"),
  services: () => import("./screens/services.js"),
  hours: () => import("./screens/hours.js"),
  staff: () => import("./screens/staff.js")
};

const NAV = [
  { route: "schedule", label: "Schedule", icon: "i-calendar" },
  { route: "new", label: "New booking", icon: "i-plus" },
  { route: "customers", label: "Customers", icon: "i-user" },
  { route: "services", label: "Services", icon: "i-scissors", owner: true },
  { route: "hours", label: "Hours", icon: "i-clock", owner: true },
  { route: "staff", label: "Staff", icon: "i-shield", owner: true }
];

let userId = null;
let profile = null;
let recovering = false;
let renderId = 0;

export function navigate(name, id = null, params = {}) {
  const hash = buildHash(name, id, params);
  if (location.hash === hash) show(); else location.hash = hash;
}

function renderProblem(message) {
  mount(root, html`
    <main class="center-card">
      <h1>Something went wrong</h1>
      <p>${message}</p>
      <button type="button" class="btn btn-primary" id="retry">Try again</button>
    </main>`);
  root.querySelector("#retry").addEventListener("click", show);
}

function renderShell(active) {
  const items = NAV.filter((n) => !n.owner || profile.role === "owner");
  mount(root, html`
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#/schedule"><span class="logo-mark"><svg class="icon"><use href="#i-sparkle"/></svg></span>Glow Salon</a>
        <div class="who">
          <span class="who-name">${profile.full_name || profile.email}</span>
          <button type="button" class="btn btn-ghost btn-small" id="sign-out">Sign out</button>
        </div>
      </header>
      <nav class="nav" aria-label="CRM">
        ${items.map((n) => html`
          <a class="nav-link${n.owner ? " owner-link" : ""}" data-route="${n.route}" href="${buildHash(n.route)}"
             ${raw(n.route === active ? 'aria-current="page"' : "")}>
            <svg class="icon" aria-hidden="true"><use href="#${n.icon}"/></svg><span>${n.label}</span>
          </a>`)}
        ${profile.role === "owner" ? html`
          <button type="button" class="nav-more" id="nav-more" aria-expanded="false">
            <svg class="icon" aria-hidden="true"><use href="#i-more"/></svg><span>More</span>
          </button>` : ""}
      </nav>
      <main id="screen" class="screen" tabindex="-1"></main>
    </div>`);
  root.querySelector("#sign-out").addEventListener("click", () => signOut());
  const more = root.querySelector("#nav-more");
  if (more) {
    more.addEventListener("click", () => {
      const open = root.querySelector(".nav").classList.toggle("more-open");
      more.setAttribute("aria-expanded", String(open));
    });
  }
}

async function show() {
  const current = ++renderId;
  const login = () => import("./screens/login.js");

  if (recovering) {
    const { renderNewPassword } = await login();
    return renderNewPassword(root, () => { recovering = false; show(); });
  }
  if (!userId) {
    const { renderLogin } = await login();
    return renderLogin(root);
  }
  if (!profile) {
    try {
      profile = await getMyProfile();
    } catch (err) {
      return renderProblem(err.message);
    }
    if (current !== renderId) return;
  }
  if (!profile || profile.role === "none") {
    const { renderWaiting } = await login();
    return renderWaiting(root, profile, () => { profile = null; show(); });
  }

  const route = parseRoute(location.hash);
  const name = allowedRoute(route, profile.role);
  const screen = name === "customers" && route.id ? "customer" : name;
  renderShell(name);
  const target = root.querySelector("#screen");
  try {
    const mod = await SCREENS[screen]();
    if (current !== renderId) return;
    await mod.render(target, { profile, id: route.id, params: route.params, navigate });
  } catch (err) {
    if (current !== renderId) return;
    console.warn(err);
    mount(target, html`
      <section class="card">
        <p class="error-text">${err.friendly ? err.message : "This screen couldn't open. Check your connection and try again."}</p>
        <button type="button" class="btn btn-ghost" id="retry">Try again</button>
      </section>`);
    target.querySelector("#retry").addEventListener("click", show);
  }
}

async function start() {
  watchConnection();
  if (!configured) {
    return mount(root, html`
      <main class="center-card">
        <h1>Almost there</h1>
        <p>Add your Supabase project URL and anon key to <code>admin/config.js</code>, then reload this page.</p>
      </main>`);
  }
  const { data } = await supabase.auth.getSession();
  userId = data.session?.user?.id ?? null;

  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id ?? null;
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (event === "PASSWORD_RECOVERY" || next !== userId) {
      userId = next;
      profile = null;
      // Supabase asks callers not to call it from inside this callback.
      setTimeout(show, 0);
    }
  });
  addEventListener("hashchange", () => {
    if (location.hash && !location.hash.startsWith("#/")) return; // login tokens, handled by Supabase
    show();
  });
  show();
}

start();
