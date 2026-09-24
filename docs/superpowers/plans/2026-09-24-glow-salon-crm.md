# Glow Salon CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private `/admin` CRM plus the database and website changes that let the owner manage bookings, customers, services, prices, hours, and staff logins.

**Architecture:** Supabase Postgres stays the single source of truth. Rules (hours, closures, capacity) live in SQL functions shared by the website (via n8n), the chat assistant, and the CRM. Access is enforced by grants and RLS policies, so the browser code only decides what to show. The CRM is plain HTML and ES modules with no build step, deployed with the existing static site.

**Tech Stack:** PostgreSQL (Supabase, tested locally on PostgreSQL 18), supabase-js 2.117.1 from jsDelivr (CRM only), vanilla JS ES modules, Node 25 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-24-glow-salon-crm-design.md`

## Global Constraints

- No em-dashes in any user-facing copy.
- No build step and no npm dependencies in the shipped site. External scripts only from `cdn.jsdelivr.net`.
- supabase-js pinned: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm`.
- Salon timezone `Asia/Manila`; phone format `09` followed by 9 digits.
- Booking sources: `website`, `ai_chat`, `walk_in`, `phone`. Statuses: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`.
- Slot lengths allowed: 15, 30, 45, 60. `closed_weekdays` uses 0 = Sunday.
- Icons allowed for services: `i-scissors`, `i-palette`, `i-lines`, `i-brush`, `i-drop`, `i-leaf`.
- Existing function names, argument lists, and `booking_details` column order stay compatible (n8n depends on them).
- Nothing is pushed to GitHub or run against the live Supabase project without the owner's go-ahead.

## Review Focus

1. A walk-in logged for a time that already started today must save; the same time via the website must be refused.
2. Editing a service's duration must not change the length of bookings already made (capacity strip and `staff_free_at`).
3. A logged-in user whose role is `none` (or anyone who self-signs-up) must see no customer data at all.
4. Text from the database (service names, customer names, notes) must be escaped before it is put into HTML.
5. Saving new hours or closures while bookings exist in the affected times must list them and require "Save anyway".

Each line is pinned by a test in the owning task: 1 and 2 in Task 3, 3 in Task 4, 4 in Task 5 (`escapeHtml`) and used by every screen, 5 in Task 5 (`bookingsOutsideRules`) and Task 11.

---

### Task 1: Local test harness, baseline schema, seed

**Files:**
- Create: `supabase/tests/supabase_stub.sql` (roles `anon`, `authenticated`, `service_role` with `bypassrls`; schema `auth` with `auth.users(id uuid, email text)`, `auth.uid()`; Supabase-style default grants on schema `public`)
- Create: `supabase/migrations/20260923_baseline.sql` (the live schema from the 2026-09-24 schema summary: 6 tables, constraints, `booking_details` view, 5 functions)
- Create: `supabase/seed.sql` (services 1-8 from `index.htm`, staff groups, settings row)
- Create: `supabase/tests/schema_summary.sql` (the schema summary query used on live)
- Create: `supabase/tests/helpers.sql` (`pg_temp.ok(cond boolean, label text)`, `pg_temp.fails(sql text, label text)`)
- Create: `supabase/tests/baseline_test.sql`
- Create: `supabase/tests/run-local.sh`

**Interfaces:**
- Produces: `bash supabase/tests/run-local.sh [baseline|crm]`. Creates a throwaway cluster, applies stub, baseline, seed, (crm migration when `crm`), then runs `baseline_test.sql` (and `crm_test.sql` when `crm`), prints `ok:` lines, exits non-zero on the first failure, always stops the cluster.
- Produces: `pg_temp.ok(boolean, text)` raises `FAILED: <label>` when false; `pg_temp.fails(text, text)` runs SQL and raises when it does not error.

- [ ] Step 1: Write `baseline_test.sql`: a website booking succeeds; a second booking in a 1-person group at an overlapping time returns `slot_taken`; a booking that ends after closing returns `outside_hours`; a past time returns `in_past`; `get_available_slots` for a 60-minute service returns 17 times on an empty open day; `booking_details` returns the booking with `end_time`.
- [ ] Step 2: Run `bash supabase/tests/run-local.sh baseline` before the baseline exists. Expected: FAIL (function `create_booking` does not exist).
- [ ] Step 3: Write stub, baseline, seed, runner.
- [ ] Step 4: Run `bash supabase/tests/run-local.sh baseline`. Expected: all `ok:` lines, exit 0.
- [ ] Step 5: Commit `test(db): add local harness and baseline schema`.

### Task 2: CRM migration part 1, schema additions

**Files:**
- Create: `supabase/migrations/20260924_crm.sql` (section 1: tables and helpers)
- Create: `supabase/tests/crm_test.sql` (section 1 tests)

**Interfaces:**
- Produces columns: `salon_settings.slot_minutes int`, `salon_settings.closed_weekdays smallint[]`; `services.description text`, `services.icon text`, `services.sort_order int`, identity on `services.id`; `bookings.duration_minutes int not null`, `bookings.price numeric not null`.
- Produces tables: `closed_dates(closed_on date pk, reason text, created_at)`, `staff_profiles(user_id uuid pk, email, full_name, role, created_at)`.
- Produces functions: `app_role() returns text`, `is_staff() returns boolean`, `is_owner() returns boolean`, `closed_reason(p_date date) returns text`, trigger `on_auth_user_created` on `auth.users`.
- Drops `salon_settings.max_parallel_bookings`.

- [ ] Step 1: Tests: existing bookings backfilled with service duration and price; inserting a service without id works and gets an id above 8; inserting `auth.users` creates a `staff_profiles` row with role `none`; `closed_reason` returns "We're closed on Sundays" for a Sunday when `closed_weekdays = '{0}'`, the stored reason for a `closed_dates` row, "We're closed that day" when the reason is null, and null for an open day; `bookings` accepts source `phone`; slot_minutes 20 is rejected.
- [ ] Step 2: Run `bash supabase/tests/run-local.sh crm`. Expected: FAIL.
- [ ] Step 3: Write migration section 1.
- [ ] Step 4: Run. Expected: PASS for baseline and section 1.
- [ ] Step 5: Commit `feat(db): add CRM tables, snapshot columns, roles, closed days`.

### Task 3: CRM migration part 2, function changes

**Files:**
- Modify: `supabase/migrations/20260924_crm.sql` (section 2)
- Modify: `supabase/tests/crm_test.sql` (section 2 tests)

**Interfaces:**
- `create_booking(...)` same signature; new refusal `{ success:false, code:'closed', message }`; walk-in past-time exemption for today; stores `duration_minutes`, `price`.
- `staff_free_at(...)` same signature; existing bookings use `b.duration_minutes`.
- `get_available_slots(p_booking_date, p_service_id)` same signature; steps by `slot_minutes`; closed day returns `{ success:true, closed:true, closed_reason, open_count:0, available_times:[] , ...service fields }`; `security definer`.
- `manage_booking(...)` same signature; reschedule rejects closed days; uses stored duration.
- `booking_details` view gains `customer_id`, `service_id`, `staff_group`, `created_at`; `security_invoker = true`.

- [ ] Step 1: Tests: closed weekday and closed date refused by `create_booking` (code `closed`), `get_available_slots` (`closed = true`), and `manage_booking` reschedule; `slot_minutes = 60` gives 9 slots for a 60-minute service from 09:00 to 18:00; walk-in at an already-started time today succeeds while the same as `website` returns `in_past`; after changing a service's duration from 60 to 30, an existing 60-minute booking still blocks the second half hour; new bookings store price and duration; `booking_details` exposes `staff_group` and `customer_id`.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Write migration section 2.
- [ ] Step 4: Run. Expected: PASS.
- [ ] Step 5: Commit `feat(db): closed days, slot length, walk-ins, booking snapshots in functions`.

### Task 4: CRM migration part 3, grants and RLS

**Files:**
- Modify: `supabase/migrations/20260924_crm.sql` (section 3)
- Modify: `supabase/tests/crm_test.sql` (section 3 tests)

**Interfaces:**
- Grants and policies exactly as spec sections 5.4 and 5.5.

- [ ] Step 1: Tests, each run after `set local role` and `set local request.jwt.claims`:
  - anon: reads active services only, settings, closed dates; `get_available_slots` works and reports correct free counts; reading `bookings`, `customers`, `booking_details`, `staff_profiles`, `verification_codes` errors; `create_booking`, `manage_booking` error.
  - role none: zero rows from `bookings`, `customers`, `booking_details`, `staff_profiles` other than own; cannot insert a booking.
  - staff: reads bookings and customers; `create_booking` walk-in works; updates `status` and `notes`; updating `booking_date` errors; editing a service, staff group, or settings errors or changes nothing; `manage_booking` errors; deleting a booking errors.
  - owner: edits services, staff groups, settings, closed dates; changes another user's role; cannot change own role.
  - service_role: `manage_booking` list still works.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Write migration section 3.
- [ ] Step 4: Run. Expected: PASS.
- [ ] Step 5: Commit `feat(db): owner and staff access rules`.

### Task 5: Pure helpers for the CRM

**Files:**
- Create: `admin/js/format.js`
- Create: `tests/format.test.mjs`

**Interfaces (all named exports):**
- `escapeHtml(value) -> string`
- `peso(n) -> string` e.g. `"₱1,800"`
- `timeToMinutes("HH:MM[:SS]") -> number`, `minutesToTime(number) -> "HH:MM"`, `to12h("HH:MM") -> "2:30 PM"`
- `addDays("YYYY-MM-DD", n) -> "YYYY-MM-DD"`, `todayInManila(now = new Date()) -> "YYYY-MM-DD"`, `dateLabel("YYYY-MM-DD") -> "Thu, Sep 24"`, `weekdayOf("YYYY-MM-DD") -> 0..6`
- `normalizePhone(raw) -> "09XXXXXXXXX" | null`
- `closedReasonFor(date, closedWeekdays, closedDates) -> string | null` (same messages as SQL `closed_reason`; `closedDates` is `[{closed_on, reason}]`)
- `slotGrid(openTime, closeTime, slotMinutes) -> ["09:00", ...]`
- `capacityBySlot(bookings, groups, slots, slotMinutes) -> { [slot]: [{ group, used, total, over }] }` (bookings: `{start_time, duration_minutes, staff_group, status}`; only pending and confirmed count)
- `statusActions(status) -> [{ status, label }]`
- `bookingsOutsideRules(bookings, rules) -> bookings[]` (rules: `{open_time, close_time, closed_weekdays, closed_dates}`)
- `customerSummary(bookings) -> { completed, noShows, lastVisit }`
- `SOURCE_LABELS`, `STATUS_LABELS`, `ICONS`

- [ ] Step 1: Write tests for every export, including `escapeHtml('<b>"x"&</b>')`, a 45-minute booking spanning two 30-minute slots, a cancelled booking not counting, a booking ending after a new closing time being listed, and a closed weekday listing.
- [ ] Step 2: Run `node --test tests/`. Expected: FAIL (module not found).
- [ ] Step 3: Implement `format.js`.
- [ ] Step 4: Run `node --test tests/`. Expected: PASS.
- [ ] Step 5: Commit `feat(admin): pure formatting and scheduling helpers`.

### Task 6: Website reads from Supabase

**Files:**
- Modify: `index.htm` (settings block, service rendering, date and time fields, submit response handling, footer hours)

**Interfaces:**
- Consumes: REST `GET /rest/v1/services?select=id,name,description,icon,duration_minutes,price&is_active=eq.true&order=sort_order,id`, `GET /rest/v1/salon_settings?select=open_time,close_time,slot_minutes,closed_weekdays,salon_phone&id=eq.1`, `GET /rest/v1/closed_dates?select=closed_on,reason&closed_on=gte.<today>`, `POST /rest/v1/rpc/get_available_slots {p_booking_date, p_service_id}`.

- [ ] Step 1: Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FALLBACK_PHONE`; rename `SERVICES` to `FALLBACK_SERVICES` (with `description` field); remove `OPEN_HOUR`, `CLOSE_HOUR`, `SLOT_MINUTES`.
- [ ] Step 2: Load data, render cards and chips with escaping, observe new `.reveal` elements, fallback mode on failure.
- [ ] Step 3: Date change shows closed reason; service or date change loads open times; empty day message; `slot_taken` refresh.
- [ ] Step 4: Friendly message for non-OK or non-JSON webhook responses; footer hours from settings.
- [ ] Step 5: Verify: extract the inline script and run `node --check`; open the page in a browser with placeholder config and confirm fallback mode renders services and the unavailable message without console errors.
- [ ] Step 6: Commit `feat(site): load services, hours, and open times from Supabase`.

### Task 7: CRM shell, data layer, login

**Files:**
- Create: `admin/index.html`, `admin/admin.css`, `admin/config.js`, `admin/js/app.js`, `admin/js/db.js`, `admin/js/ui.js`, `admin/js/screens/login.js`

**Interfaces:**
- `config.js`: `export const SUPABASE_URL`, `export const SUPABASE_ANON_KEY`.
- `db.js`: `supabase`, `friendlyError(err) -> string`, `signIn(email, password)`, `signOut()`, `sendPasswordReset(email)`, `onAuthChange(cb)`, `getMyProfile() -> {user_id,email,full_name,role} | null`, `getSettings()`, `getStaffGroups()`, `getServices({ includeInactive })`, `getClosedDates()`, `getAvailableSlots(date, serviceId)`, `createBooking(params)`, `listDayBookings(date)`, `setBookingStatus(id, status)`, `setBookingNotes(id, notes)`, `findCustomerByPhone(phone)`, `searchCustomers(q)`, `getCustomer(id)`, `updateCustomer(id, fields)`, `listCustomerBookings(customerId)`, `saveService(service)`, `swapServiceOrder(a, b)`, `saveStaffGroup(group)`, `saveSettings(fields)`, `addClosedDate(date, reason)`, `removeClosedDate(date)`, `listUpcomingBookings(fromDate)`, `listStaffProfiles()`, `setStaffRole(userId, role)`. All throw `Error` whose `message` is already user-friendly.
- `ui.js`: `html` tagged template that escapes interpolations, `raw(str)`, `mount(el, markup)`, `toast(message, type)`, `confirmDialog(message) -> Promise<boolean>`, `setBusy(button, busy)`, `connectionBanner()`.
- `app.js`: routes `#/login`, `#/schedule`, `#/new`, `#/customers`, `#/customers/<id>`, `#/services`, `#/hours`, `#/staff`; screens export `render(root, ctx)` where `ctx = { profile, params, navigate }`.

- [ ] Step 1: Tests: add `tests/ui.test.mjs` for the `html` template escaping and `raw` passthrough, and `tests/routes.test.mjs` for `parseRoute('#/customers/abc?x=1')`.
- [ ] Step 2: Run `node --test tests/`. Expected: FAIL.
- [ ] Step 3: Implement shell, CSS, data layer, login, waiting-for-approval view, role-based nav, connection banner.
- [ ] Step 4: Run tests and `node --check` on every module. Expected: PASS.
- [ ] Step 5: Commit `feat(admin): shell, data layer, and login`.

### Task 8: Schedule screen

**Files:** Create `admin/js/screens/schedule.js`

- [ ] Step 1: Day picker (previous, today, next), bookings list from `listDayBookings`, `tel:` and `sms:` links, source and status badges, `statusActions` buttons with cancel confirmation, inline notes, capacity strip from `capacityBySlot` with over-capacity highlight.
- [ ] Step 2: `node --check`; `node --test tests/`.
- [ ] Step 3: Commit `feat(admin): schedule screen`.

### Task 9: New booking screen

**Files:** Create `admin/js/screens/new-booking.js`

- [ ] Step 1: Source (Walk-in, Phone), service, date, time from `getAvailableSlots`, phone lookup with prefill, name, email, notes, save via `createBooking`; refusal messages; `slot_taken` refreshes times; prefill from `?customer=<id>`.
- [ ] Step 2: `node --check`; `node --test tests/`.
- [ ] Step 3: Commit `feat(admin): walk-in and phone bookings`.

### Task 10: Customers and customer page

**Files:** Create `admin/js/screens/customers.js`, `admin/js/screens/customer.js`

- [ ] Step 1: Search list; customer page with editable details, duplicate-phone error, `customerSummary`, upcoming and past bookings, Book again.
- [ ] Step 2: `node --check`; `node --test tests/`.
- [ ] Step 3: Commit `feat(admin): customers`.

### Task 11: Services, hours, staff (owner screens)

**Files:** Create `admin/js/screens/services.js`, `admin/js/screens/hours.js`, `admin/js/screens/staff.js`

- [ ] Step 1: Services list and edit form (icon picker, active toggle with upcoming-bookings warning, reorder), staff groups editor.
- [ ] Step 2: Hours form (close after open, slot length, closed weekdays, salon name and phone), closed dates list; warnings via `bookingsOutsideRules` with "Save anyway".
- [ ] Step 3: Staff list, role changes for other users, own row read only, invite note.
- [ ] Step 4: `node --check`; `node --test tests/`.
- [ ] Step 5: Commit `feat(admin): owner screens for services, hours, and staff`.

### Task 12: Site config, checklist, setup guide

**Files:**
- Modify: `robots.txt` (add `Disallow: /admin`)
- Modify: `vercel.json` (rewrite `/admin` to `/admin/index.html`)
- Create: `.vercelignore` (`docs`, `supabase`, `tests`)
- Create: `tests/crm-checklist.md`
- Create: `supabase/README.md` (rollout steps from spec section 11 in order, with exact SQL for setting the owner)

- [ ] Step 1: Write files.
- [ ] Step 2: Run the full local suite: `bash supabase/tests/run-local.sh crm` and `node --test tests/`. Expected: PASS.
- [ ] Step 3: Commit `chore: admin routing, robots, deploy ignore, setup guide`.
