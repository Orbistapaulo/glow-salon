// Sign-in, waiting-for-approval and set-a-new-password screens.
import { signIn, signOut, sendPasswordReset, updatePassword } from "../db.js";
import { html, mount, setBusy } from "../ui.js";

const brand = html`<p class="brand brand-lg"><span class="logo-mark"><svg class="icon"><use href="#i-sparkle"/></svg></span>Glow Salon</p>`;

export function renderLogin(root) {
  mount(root, html`
    <main class="center-card">
      ${brand}
      <h1>Sign in</h1>
      <form id="login-form" novalidate>
        <label class="field"><span class="field-label">Email</span>
          <input id="login-email" type="email" autocomplete="username" required></label>
        <label class="field"><span class="field-label">Password</span>
          <input id="login-password" type="password" autocomplete="current-password" required></label>
        <p class="error-text" id="login-error" role="alert"></p>
        <p class="ok-text" id="login-message" role="status"></p>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
        <button class="link-button" type="button" id="forgot-password">Forgot password?</button>
      </form>
    </main>`);

  const form = root.querySelector("#login-form");
  const error = root.querySelector("#login-error");
  const message = root.querySelector("#login-message");
  const email = () => root.querySelector("#login-email").value.trim();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    message.textContent = "";
    const password = root.querySelector("#login-password").value;
    if (!email() || !password) { error.textContent = "Enter your email and password."; return; }
    const button = form.querySelector("[type=submit]");
    setBusy(button, true, "Signing in...");
    try {
      await signIn(email(), password);
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false);
    }
  });

  root.querySelector("#forgot-password").addEventListener("click", async () => {
    error.textContent = "";
    message.textContent = "";
    if (!email()) { error.textContent = "Type your email first, then tap Forgot password."; return; }
    try {
      await sendPasswordReset(email());
      message.textContent = "If that email has a login, a reset link is on its way.";
    } catch (err) {
      error.textContent = err.message;
    }
  });
}

export function renderWaiting(root, profile, onCheckAgain) {
  mount(root, html`
    <main class="center-card">
      ${brand}
      <h1>Waiting for the owner to approve your account</h1>
      <p>You're signed in as <strong>${profile?.email}</strong>. Ask the salon owner to approve you on the Staff page, then check again.</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" id="check-again">Check again</button>
        <button type="button" class="btn btn-ghost" id="sign-out">Sign out</button>
      </div>
    </main>`);
  root.querySelector("#check-again").addEventListener("click", onCheckAgain);
  root.querySelector("#sign-out").addEventListener("click", () => signOut());
}

export function renderNewPassword(root, done) {
  mount(root, html`
    <main class="center-card">
      ${brand}
      <h1>Set a new password</h1>
      <form id="password-form" novalidate>
        <label class="field"><span class="field-label">New password</span>
          <input id="new-password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span class="field-label">Type it again</span>
          <input id="new-password-2" type="password" autocomplete="new-password" required></label>
        <p class="error-text" id="password-error" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">Save password</button>
      </form>
    </main>`);
  const form = root.querySelector("#password-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = root.querySelector("#password-error");
    const a = root.querySelector("#new-password").value, b = root.querySelector("#new-password-2").value;
    if (a.length < 8) { error.textContent = "Use at least 8 characters."; return; }
    if (a !== b) { error.textContent = "The two passwords don't match."; return; }
    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      await updatePassword(a);
      done();
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false);
    }
  });
}
