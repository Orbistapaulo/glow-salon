# Glow Salon CRM: Design

Date: 2026-09-24
Status: Draft for owner review

## 1. Purpose

The salon owner needs a private back office for the Glow Salon booking site to:

- see who booked, what, and when;
- manage bookings day to day (status changes, walk-in and phone bookings, customer history);
- change what customers can book online (services, prices, durations, opening hours, slot length, closed days, staff per group) without editing code.

Success means: a price, service, or opening-hours change made in the CRM shows up on the public website on the next page load, staff can run the day from a phone, and no booking path (website, chat assistant, CRM) can overbook a staff group.

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| Owner | The salon owner | Everything staff can do, plus services, prices, durations, staff groups, opening hours, slot length, closures, salon details, and approving staff logins |
| Staff | Front desk and stylists | View the schedule, change booking status and notes, add walk-in and phone bookings, view and edit customers |
| None | Any login not yet approved | Nothing. Sees a "waiting for approval" screen |

Customers never log in to the CRM.

## 3. Scope

### In scope

- Database changes and access rules in Supabase (section 5).
- Website (`index.htm`) reading services, hours, closures, and open slots from Supabase (section 6).
- n8n booking workflow returning clear results instead of a generic 500 (section 7).
- A CRM at `/admin` with the screens in section 8.

### Out of scope for this version

- Rescheduling a booking from the CRM (customers can still reschedule through the chat assistant).
- Sending SMS from CRM actions (walk-in confirmations, staff cancellations).
- Deleting bookings or customers in the CRM (cancel instead; rare deletions happen in the Supabase dashboard).
- Assigning bookings to individual stylists, reports and revenue totals, payments, multiple branches, offline mode, data export.

## 4. Current state (as of 2026-09-24)

**Hosting:** static site in this repo, deployed on Vercel. Booking form and chat bubble post to n8n cloud. n8n uses the Supabase service key.

**Tables:** `services`, `staff_groups`, `salon_settings` (single row, `id = 1`), `customers` (unique `phone`), `bookings`, `verification_codes`. View: `booking_details`.

**Functions already in place:**

- `create_booking(...)`: validates details, service, past times, opening hours; takes a per-date advisory lock; checks capacity via `staff_free_at`; upserts the customer by phone; inserts a `confirmed` booking; returns `{ success, code, message, ... }`.
- `get_available_slots(date, service_id)`: open times for a service on a date. Slot step is hardcoded to 30 minutes.
- `manage_booking(action, phone, code, ...)`: customer self-service (send_code, list, cancel, reschedule) used by the chat assistant. `send_code` returns the plain SMS code in its response for n8n to send.
- `check_verification_code(phone, code)` and `staff_free_at(date, start, service_id, exclude_booking)`.

**Capacity model:** each service belongs to a `staff_group`; a booking needs a free person in its group (`staff_groups.staff_count` minus overlapping pending or confirmed bookings in that group). `salon_settings.max_parallel_bookings` exists but nothing uses it.

**Access:** row level security (RLS) is on for every table and there are no policies, so only the service key can read or write. No triggers.

**Known problems:**

- The booking form gets an n8n 500 "Error in workflow". Cause not yet known (needs the n8n execution error or workflow export).
- `booking_details` is a normal view, so it runs with its owner's rights and ignores RLS. Anyone holding the public (anon) key could read every customer's name and phone through it. Not exploitable today because the site does not ship a Supabase key, but the CRM will.
- Services, prices, and hours are duplicated as constants in `index.htm` (lines 750-762) and can drift from the database.
- `services.id` has no default, so a new service cannot be inserted without choosing an id by hand.
- Bookings do not store their duration or price. Changing a service's duration silently changes the length of every existing booking of that service in the capacity check, and a price change rewrites history in `booking_details`.

## 5. Database changes

The current schema exists only in Supabase, so it is first captured in the repo as `supabase/migrations/20260923_baseline.sql`: tables, constraints, the `booking_details` view, and the five existing functions, reconstructed from the live schema. It is verified by running the schema summary query on both projects and comparing the output. It is never run against the live project. `supabase/seed.sql` holds the live `services`, `staff_groups`, and `salon_settings` rows (no customer data) for the test project.

All CRM changes live in one migration file, `supabase/migrations/20260924_crm.sql`, run once in the SQL Editor (test project first, then live). Changes are additive: nothing the current n8n workflows use is renamed.

### 5.1 Tables

**`salon_settings`**

- Add `slot_minutes int not null default 30`, check `slot_minutes in (15, 30, 45, 60)`.
- Add `closed_weekdays smallint[] not null default '{}'`. Values are 0-6 with 0 = Sunday, matching Postgres `extract(dow ...)`.
- Drop `max_parallel_bookings`, only after confirming neither n8n workflow reads it.

**`closed_dates`** (new)

- `closed_on date primary key`, `reason text`, `created_at timestamptz not null default now()`.

**`services`**

- Make `id` generated by default as identity, with the sequence set past the current highest id.
- Add `description text` (the card blurb, seeded from the current `index.htm` list).
- Add `icon text not null default 'i-scissors'`, check in (`i-scissors`, `i-palette`, `i-lines`, `i-brush`, `i-drop`, `i-leaf`). These match the SVG symbols already in `index.htm`.
- Add `sort_order int not null default 0` (seeded to match the current order).

**`bookings`**

- Add `duration_minutes int` and `price numeric`, backfilled from the booking's service, then set `not null`. `create_booking` fills them for new bookings.
- Extend `bookings_source_check` to allow `phone` (values: `website`, `ai_chat`, `walk_in`, `phone`).

**`staff_profiles`** (new)

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `email text`, `full_name text`
- `role text not null default 'none'`, check in (`none`, `staff`, `owner`)
- `created_at timestamptz not null default now()`

A trigger on `auth.users` (after insert) creates a `staff_profiles` row with role `none`. The owner row is set once by SQL during rollout.

### 5.2 Helper functions (new)

- `app_role()`: role of `auth.uid()` from `staff_profiles`, or `'none'`. `security definer`, `stable`, `set search_path = public`.
- `is_staff()`: `app_role() in ('staff', 'owner')`.
- `is_owner()`: `app_role() = 'owner'`.
- `closed_reason(p_date date)`: returns the reason text if the salon is closed that day (weekly closed day gives e.g. "We're closed on Sundays"; a `closed_dates` row gives its reason or "We're closed that day"), otherwise `null`. This is the single source of the closed-day rule.

### 5.3 Changes to existing functions

**`create_booking`**

- New check after the service lookup: if `closed_reason(p_booking_date)` is not null, return `{ success: false, code: 'closed', message: <reason> }`.
- Past-time check: skip it when `p_source = 'walk_in'` and `p_booking_date` is today in the salon timezone, so a walk-in that already started can be logged. All other sources keep the check.
- Accept `phone` as a source.
- Insert `duration_minutes` and `price` from the service at booking time.

**`staff_free_at`**

- Use the booking's own `b.duration_minutes` for existing bookings instead of the service's current duration. The new booking's length still comes from the service.

**`get_available_slots`**

- Step by `slot_minutes` instead of 30.
- If the date is closed, return `{ success: true, closed: true, closed_reason, open_count: 0, available_times: [] }` plus the existing service fields. Adding fields keeps the chat assistant compatible.
- Becomes `security definer` with `set search_path = public`, so the public website can call it. It only returns times and free counts, never customer data.

**`manage_booking` (reschedule branch)**

- Reject closed days using `closed_reason`.
- Use the booking's stored `duration_minutes`.

**`booking_details`**

- Recreate with `security_invoker = true` so it obeys RLS.
- Add `customer_id`, `service_id`, `created_at`; take `duration_minutes` and `price` from the booking.

### 5.4 Function permissions

Supabase grants execute to `anon` and `authenticated` explicitly, so each revoke names those roles as well as `public`.

| Function | anon (website) | authenticated (CRM) | service_role (n8n) |
|---|---|---|---|
| `get_available_slots` | yes | yes | yes |
| `create_booking` | no | yes (RLS limits it to staff) | yes |
| `staff_free_at` | no | yes (used inside `create_booking`) | yes |
| `manage_booking` | no | no | yes |
| `check_verification_code` | no | no | yes |
| `app_role`, `is_staff`, `is_owner` | no | yes | yes |
| `closed_reason` | no | yes | yes |

### 5.5 Access rules (RLS policies and grants)

| Table | anon (website) | Staff | Owner |
|---|---|---|---|
| `services` | select where `is_active` | select | select, insert, update |
| `staff_groups` | none | select | select, insert, update |
| `salon_settings` | select | select | select, update |
| `closed_dates` | select | select | select, insert, update, delete |
| `bookings` | none | select, insert, update (`status`, `notes` only) | same as staff |
| `customers` | none | select, insert, update | same as staff |
| `staff_profiles` | none | select own row | select all; update `role`, `full_name` of other users only |
| `verification_codes` | none | none | none |

Notes:

- "Staff" policies use `is_staff()` and "Owner" policies use `is_owner()`. A logged-in user with role `none` matches nothing.
- Column limits use grants: revoke `update` on `bookings` from `authenticated`, then grant `update (status, notes)`. Same for `staff_profiles` (`role`, `full_name`).
- The owner cannot change their own `staff_profiles` row (policy condition `user_id <> auth.uid()`), which prevents accidental lockout.
- No delete policy on `bookings` or `customers`. `customers` deletion cascades to bookings, so it stays a dashboard-only action.
- Revoke all table privileges on `verification_codes` from `anon` and `authenticated`.
- Supabase Auth setting: turn off "Allow new users to sign up". Staff are invited from the Supabase dashboard. Even if sign-ups were left on, new users get role `none`.

## 6. Website changes (`index.htm`)

- Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the settings block. The anon key is public by design; section 5.5 limits it to read-only public data.
- Load supabase-js v2 from jsDelivr as an ES module, with the exact version pinned at implementation time. Create the client with `auth: { persistSession: false }` so the website always acts as anon, even in a browser where someone is logged in to `/admin` on the same domain.
- On page load, fetch in parallel:
  - active services ordered by `sort_order` (id, name, description, icon, duration_minutes, price);
  - `salon_settings` (open_time, close_time, slot_minutes, closed_weekdays, salon_phone, timezone);
  - `closed_dates` from today onward.
- Render service cards and the service choices from the fetched services.
- Date field: keep `min` = today. On change, if the date is closed, show the reason under the field and clear the time list.
- Time list: when both service and date are set, call `get_available_slots` and list only returned times. Show "Fully booked that day, try another date" when `open_count` is 0. Refresh after a `slot_taken` result.
- Submission is unchanged: POST to the n8n webhook with the same payload.
- Response handling: if the response is not OK or not JSON, show "The booking didn't go through. Try again, or text us at <salon_phone>." Never show n8n's raw "Error in workflow" text.
- Fallback: rename the hardcoded `SERVICES` constant to `FALLBACK_SERVICES` and add a `FALLBACK_PHONE` constant set to the live `salon_phone`. If the Supabase fetch fails, render the service cards from `FALLBACK_SERVICES` and replace the form with "Online booking is unavailable right now. Text us at <phone> to book.", using `salon_phone` when settings loaded and `FALLBACK_PHONE` otherwise. Remove the `OPEN_HOUR`, `CLOSE_HOUR`, `SLOT_MINUTES` constants.

## 7. n8n changes

### 7.1 Booking webhook (`/webhook/salon-booking`)

Contract:

1. Receive the JSON payload the page sends today.
2. Call RPC `create_booking` with: `full_name -> p_full_name`, `phone -> p_phone`, `email -> p_email`, `service_id -> p_service_id`, `booking_date -> p_booking_date`, `start_time -> p_start_time`, `notes -> p_notes`, `sms_opt_in -> p_sms_opt_in`, `p_source = 'website'`.
3. If `success` is true and `sms_opt_in` is true, send the confirmation SMS (existing step).
4. Respond to the webhook with the `create_booking` JSON and HTTP 200, for both successful and refused bookings.
5. On any unexpected node error, respond with HTTP 200 and `{ "success": false, "message": "The booking didn't go through. Try again, or text us to book." }` via the node's error output, not the default 500.

This contract must be checked against the exported workflow before implementation. The 500 root cause is found and fixed in this step.

### 7.2 Chat assistant

No change required. It keeps calling `get_available_slots`, `create_booking` (source `ai_chat`), and `manage_booking` with the service key, which is unaffected by the new permissions. Closed-day rules apply automatically because they live in the functions. Verify that no tool reads `max_parallel_bookings` or assumes 30-minute slots.

### 7.3 CRM

The CRM does not use n8n. It calls Supabase directly as the logged-in user.

## 8. CRM (`/admin`)

### 8.1 Structure

Plain HTML, CSS, and JavaScript ES modules. No build step, served by the same Vercel project.

```
admin/
  index.html            shell, nav, <meta name="robots" content="noindex">
  admin.css             salon colours (#8A3B62 family) and fonts (Source Sans 3)
  js/
    app.js              hash router, auth guard, role-based nav
    db.js               supabase-js client (persistent session) and typed query helpers
    format.js           pure helpers: time labels, peso format, slot grid, capacity per group
    screens/
      login.js
      schedule.js
      new-booking.js
      customers.js      search list
      customer.js       single customer page
      services.js       services and staff groups (owner)
      hours.js          hours, slot length, closures, salon details (owner)
      staff.js          logins and roles (owner)
```

Routes: `#/schedule?date=YYYY-MM-DD` (default), `#/new`, `#/customers`, `#/customers/<id>`, `#/services`, `#/hours`, `#/staff`, `#/login`.

Layout: bottom nav on phones (Schedule, New, Customers, More), sidebar on wider screens. Owner-only items are hidden for staff.

Also: add `Disallow: /admin` to `robots.txt`; add a `vercel.json` rewrite for `/admin` if needed; add a `.vercelignore` so `docs/`, `supabase/`, and `tests/` are not published on the website.

### 8.2 Screens

**Login (all).** Email and password via Supabase Auth, and "Forgot password" (Supabase reset email). After login, role `none` shows "Waiting for the owner to approve your account" and a sign-out button.

**Schedule (staff, owner).**

- Day picker with previous, today, next.
- Bookings for the day from `booking_details`, ordered by start time.
- Each row: start-end time, customer name, phone as `tel:` and `sms:` links, service, source badge (website, chat, walk-in, phone), status badge.
- Actions by status:
  - pending: Confirm, Cancel
  - confirmed: Completed, No-show, Cancel
  - completed, no_show, cancelled: none (read only)
- Cancel asks for confirmation.
- Notes are editable inline.
- Capacity strip: for each slot of the day (using `slot_minutes`), bookings per staff group versus `staff_count`, e.g. "Hair 2/3". Slots over capacity (possible after lowering a staff count) are highlighted.

**New booking (staff, owner).**

1. Choose source (Walk-in, Phone), then service, then date.
2. Choose a time from `get_available_slots`.
3. Enter the phone number. An existing customer's name and email fill in.
4. Add name (if new) and notes.
5. Save via `create_booking`.

On `slot_taken` the time list refreshes; other refusal messages show next to the Save button.

**Customers (staff, owner).**

- Search by name or phone (case-insensitive partial match).
- Customer page: editable name, email, SMS opt-in; phone shown and editable with a clear error if another customer already has it.
- Summary: completed visits, no-shows, last completed visit.
- Upcoming and past bookings with status.
- "Book again" opens New booking with the customer filled in.

**Services (owner).**

- List ordered by `sort_order` with up and down buttons, active toggle, edit.
- Edit form: name, description, icon (six choices shown as icons), duration, price, staff group.
- Turning off a service with upcoming bookings lists those bookings first and asks to continue. Bookings are kept.
- Staff groups: name and staff count; add a group.

**Hours and closures (owner).**

- Open time, close time (close must be after open), slot length, weekly closed days, salon name and phone.
- Closed dates: list of upcoming closures with reasons; add and remove.
- Saving hours or closed weekdays, or adding a closed date, first lists upcoming pending or confirmed bookings that would fall outside the new rules and requires "Save anyway". Nothing is cancelled automatically.

**Staff (owner).**

- All `staff_profiles` rows with email, name, role.
- Set role to staff or none for other users. The owner's own row is read only.
- A note with a link to the Supabase dashboard's invite page.

## 9. Error handling

- **Refusals from database functions** (`success: false`) show their `message` next to the action that triggered it.
- **Permission errors** from Supabase (RLS or grant) show "You don't have permission for that." Staff never see owner screens, so this is a backstop.
- **Network failure:** a banner "No connection: changes aren't saved" and save buttons disabled until the connection returns. No offline queue.
- **Session expiry:** supabase-js refreshes sessions automatically. If refresh fails, go to login with "Please sign in again."
- **Concurrent edits:** last write wins for status and notes.
- **Form validation** mirrors database checks (price >= 0, duration > 0, close after open, allowed slot lengths, valid phone `09` + 9 digits). Database constraints remain the final check.
- **Website:** as in section 6.

## 10. Testing

**Database:** `supabase/tests/crm_test.sql`, run in the SQL Editor. It runs inside a transaction that always ends in `rollback`, and raises an exception on the first failed check. It covers:

- Capacity per staff group, including overlap and a group at full capacity.
- A duration change on a service does not change existing bookings' length in `staff_free_at`.
- Closed weekday and closed date refusals in `create_booking`, `get_available_slots`, and `manage_booking` reschedule.
- `slot_minutes` respected by `get_available_slots`.
- Walk-in allowed earlier today; website booking in the past refused.
- `price` and `duration_minutes` stored on new bookings.
- Access, by switching role and JWT claims to simulate each actor:
  - anon: can read active services, settings, closed dates, and slots; cannot read bookings, customers, `booking_details`, or `staff_profiles`; cannot run `create_booking` or `manage_booking`.
  - role none: no rows from any CRM table.
  - staff: can read and add bookings and customers, update booking status and notes only, cannot edit services or settings, cannot run `manage_booking`.
  - owner: can edit services, settings, closures, and other users' roles; cannot change own role.

**JavaScript:** pure helpers in `admin/js/format.js` tested with Node's built-in runner (`node --test`), no dependencies. Tests live in `tests/`.

**CRM:** a manual checklist per role (owner, staff, none) in `tests/crm-checklist.md`, run in a browser against the test Supabase project before going live.

**n8n:** against the test project, submit a successful booking, a booking into a full slot, and a booking on a closed day; each must return a clear message and HTTP 200.

## 11. Rollout

Each step leaves the live site working.

1. Create a free second Supabase project for testing. Run `20260923_baseline.sql` and `seed.sql`, compare its schema summary with live, then run `20260924_crm.sql` and `crm_test.sql` there.
2. Apply the migration to the live project. The current site and chat keep working because nothing they use is renamed.
3. Update the n8n booking workflow to the section 7.1 contract, fixing the 500.
4. Publish the website update (section 6).
5. Publish `/admin`. Set the owner's `staff_profiles.role` to `owner` by SQL, turn off public sign-ups, invite staff, approve them in the Staff screen.

## 12. Open items

1. Exports of both n8n workflows (booking form and chat), saved into this folder. Needed to confirm section 7 and to find the 500 cause.
2. The owner's login email for the owner account.
3. Supabase project URL and anon key for the website and CRM config.
4. Whether the live project is on the free plan (affects the backup options in rollout step 2).
5. The live rows of `services`, `staff_groups`, and `salon_settings` (no customer data), for `seed.sql` and to confirm each service's staff group.
