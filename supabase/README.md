# Setting up the Glow Salon CRM

This folder holds the database changes for the CRM at `/admin` and the tests for them. Do the steps in order. Each step leaves the live website working.

Everything here has already been run and tested on a local copy whose tables, columns and constraints match your live database (`bash supabase/tests/run-local.sh crm`, 94 checks, also with prices stored as `numeric(10,2)`). The local copy imitates Supabase's logins and roles, so the test project in step 1 is the real-Supabase check, and a safety net because Supabase's free plan has no backups you can restore.

## What you need

- Your Supabase project, and a second free project for testing (step 1).
- The Supabase **Project URL** and **anon public key** (or **publishable key**): Project Settings, then API Keys.
- The Supabase **service_role key**, for n8n only. Never put it in the website or the CRM.
- `psql`, which is already installed on your computer, for the test run in step 1.

## 1. Rehearse on a test project (recommended)

1. Create a new free Supabase project, for example `glow-salon-test`.
2. In its SQL Editor, run these files in this order (open each file, copy everything, paste, Run):
   1. `supabase/migrations/20260923_baseline.sql` (a copy of your current live database)
   2. `supabase/seed.sql`. Before running it, change the staff group names and counts to match your live `staff_groups` table, and check each service's `staff_group`.
   3. `supabase/tests/fixtures_pre_crm.sql` (one test booking, test project only)
   4. `supabase/migrations/20260924_crm.sql`
   5. `supabase/migrations/20260925_drop_max_parallel_bookings.sql`
3. Run the tests from this folder in a terminal. Get the connection string from the test project's **Connect** button (Session pooler), then:
   ```
   psql "postgresql://postgres.xxxx:PASSWORD@aws-0-xxxx.pooler.supabase.com:5432/postgres" -f supabase/tests/crm_test.sql
   ```
   Every line should start with `ok:`. A line with `FAILED` or `ERROR` means stop and send it to me. The tests undo all their changes when they finish.

## 2. Check n8n before changing the live database

Open both n8n workflows (booking form and chat assistant) and search each node for `max_parallel_bookings`.

- Not found: you will run the drop file in step 3.
- Found: skip the drop file for now and tell me which node uses it.

## 3. Update the live database

In your live project's SQL Editor:

1. Run `supabase/migrations/20260924_crm.sql`. If Supabase warns about destructive operations, that refers to the replaced booking checks and tightened permissions; confirm.
2. If step 2 found nothing, run `supabase/migrations/20260925_drop_max_parallel_bookings.sql`.

The website and chat keep working exactly as before after this step.

## 4. Fix the n8n booking webhook

This is also the fix for the current 500 "Error in workflow". Open the failed run in n8n's **Executions** tab first: the red node shows what broke today.

Set the booking workflow up like this:

1. **Webhook** node: POST, path `salon-booking`, Respond: **Using 'Respond to Webhook' Node**.
2. **HTTP Request** node, named `Create booking`:
   - Method POST, URL `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/create_booking`
   - Authentication: Predefined Credential Type, **Supabase API**, using the service_role key.
   - Send Body: JSON:
     ```
     {
       "p_full_name": {{ JSON.stringify($json.body.full_name) }},
       "p_phone": {{ JSON.stringify($json.body.phone) }},
       "p_email": {{ JSON.stringify($json.body.email) }},
       "p_service_id": {{ Number($json.body.service_id) }},
       "p_booking_date": {{ JSON.stringify($json.body.booking_date) }},
       "p_start_time": {{ JSON.stringify($json.body.start_time) }},
       "p_notes": {{ JSON.stringify($json.body.notes) }},
       "p_sms_opt_in": {{ $json.body.sms_opt_in === true }},
       "p_source": "website"
     }
     ```
     `JSON.stringify` keeps names or notes that contain quote marks from breaking the request.
   - Settings: **On Error: Continue (using error output)**.
3. **Respond to Webhook** node straight after `Create booking` (normal output): Respond With JSON, body `{{ $('Create booking').item.json }}`, response code 200. It answers the website first, whether the booking was made or refused, and passes the data on to the next node.
4. **IF** node after that: `{{ $('Create booking').item.json.success }}` is true **and** `{{ $('Webhook').item.json.body.sms_opt_in }}` is true, then your existing SMS step. On the SMS node, set **On Error: Continue**, so a texting problem never turns a saved booking into an error.
5. A second **Respond to Webhook** on the error output of `Create booking`: response code 200, JSON body:
   ```
   { "success": false, "message": "The booking didn't go through. Try again, or text us to book." }
   ```

The website shows the message from `create_booking` (for example "Sorry, everyone is booked at that time") and never shows n8n's own error text. Because the website gets its answer before the SMS is sent, a failed text can't make a saved booking look failed.

The chat assistant workflow needs no changes.

## 5. Logins

In your live project:

1. **Authentication, Sign In / Providers**: turn off **Allow new users to sign up**. Keep Email turned on.
2. **Authentication, URL Configuration**: set Site URL to `https://glow-salon-tau.vercel.app/admin/` and add the same address to Redirect URLs. Invite and password-reset emails send people there, where the CRM asks them to choose a password. (The public website doesn't use Supabase logins, so it doesn't need to be the Site URL.)
3. **Authentication, Users, Add user**: create your own login with your email and a password.
4. In the SQL Editor, make yourself the owner:
   ```sql
   update staff_profiles
   set role = 'owner', full_name = 'Your Name'
   where email = 'you@example.com';
   ```
5. Invite staff from **Authentication, Users, Invite user**. The invite email opens the CRM, which asks them to choose a password. They then see "Waiting for the owner to approve your account" until you set them to Staff on the CRM's Staff page.

## 6. Connect the website and the CRM

Put the Project URL and the anon (or publishable) key in both files:

- `index.htm`: `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the top of the script.
- `admin/config.js`: the same two values.

Until both are filled in, the website shows the built-in services and "Online booking is unavailable right now", so do this before publishing.

## 7. Publish and check

Push to GitHub so Vercel deploys, then:

1. Open the website: services and prices load, a closed day says so, and only open times are listed.
2. Make a test booking on the website and check it on the CRM's Schedule.
3. Work through `tests/crm-checklist.md` once.

## Running the tests on your computer

```
bash supabase/tests/run-local.sh crm      # database: 94 checks on a throwaway local copy (also: crm-numeric)
node --test "tests/*.test.mjs"            # website and CRM in headless Chrome, plus helpers
```
