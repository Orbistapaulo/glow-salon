-- Tests for supabase/migrations/20260924_crm.sql. Everything is rolled back at the end.
\ir helpers.sql

begin;

-- ---------------------------------------------------------------------------
-- Section 1: tables, columns, roles, closed days (run as the database owner)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id bigint;
  v_user uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_sunday date := (now() at time zone 'Asia/Manila')::date
                   + (7 - extract(dow from (now() at time zone 'Asia/Manila')::date)::int);
begin
  perform pg_temp.ok(
    (select duration_minutes = 120 and price = 1800 from bookings
      where id = '00000000-0000-0000-0000-00000000b001'),
    'existing booking gets its service duration and price');

  insert into services (name, duration_minutes, price, staff_group)
  values ('Test Service', 30, 100, 'hair') returning id into v_id;
  perform pg_temp.ok(v_id > 8, 'new service gets an id above the existing ones');

  perform pg_temp.ok(
    (select description is not null and icon = 'i-palette' and sort_order = 3 from services where id = 3),
    'existing services get description, icon and order from the website list');

  insert into bookings (customer_id, service_id, booking_date, start_time, source)
  values ('00000000-0000-0000-0000-00000000c001', 5, v_today + 40, '11:00', 'phone');
  perform pg_temp.ok(
    (select duration_minutes = 45 and price = 300 from bookings
      where booking_date = v_today + 40 and start_time = '11:00'),
    'a direct insert without duration and price is filled from the service');
  perform pg_temp.ok(true, 'bookings accept source phone');

  insert into auth.users (email) values ('new.person@example.com') returning id into v_user;
  perform pg_temp.ok(
    (select role = 'none' and email = 'new.person@example.com' from staff_profiles where user_id = v_user),
    'a new login gets a staff profile with role none');

  perform pg_temp.ok(app_role() = 'none', 'no logged-in user means role none');
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform pg_temp.ok(app_role() = 'none' and not is_staff(), 'unapproved login is not staff');
  update staff_profiles set role = 'staff' where user_id = v_user;
  perform pg_temp.ok(is_staff() and not is_owner(), 'staff role is staff but not owner');
  update staff_profiles set role = 'owner' where user_id = v_user;
  perform pg_temp.ok(is_staff() and is_owner(), 'owner role counts as staff and owner');
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.ok(closed_reason(v_sunday) is null, 'open day has no closed reason');
  update salon_settings set closed_weekdays = '{0}';
  perform pg_temp.ok(closed_reason(v_sunday) = 'We''re closed on Sundays.', 'weekly closed day gives its reason');
  insert into closed_dates (closed_on, reason) values (v_today + 50, 'Staff training');
  perform pg_temp.ok(closed_reason(v_today + 50) = 'We''re closed that day (Staff training).', 'closed date gives its reason');
  insert into closed_dates (closed_on) values (v_today + 51);
  perform pg_temp.ok(closed_reason(v_today + 51) = 'We''re closed that day.', 'closed date without a reason');
  update salon_settings set closed_weekdays = '{}';

  perform pg_temp.ok(
    not exists (select 1 from information_schema.columns
                where table_name = 'salon_settings' and column_name = 'max_parallel_bookings'),
    'unused max_parallel_bookings is removed');
end;
$$;

select pg_temp.fails($q$ update salon_settings set slot_minutes = 20 $q$, 'slot length must be 15, 30, 45 or 60');
select pg_temp.fails($q$ update salon_settings set closed_weekdays = '{7}' $q$, 'closed weekdays must be 0 to 6');
select pg_temp.fails($q$ update services set icon = 'i-rocket' where id = 1 $q$, 'service icon must be one of the site icons');
select pg_temp.fails($q$ update staff_profiles set role = 'admin' $q$, 'staff role must be none, staff or owner');

-- ---------------------------------------------------------------------------
-- Section 2: booking functions (run as the database owner, like n8n)
-- ---------------------------------------------------------------------------
do $$
declare
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_now     time := (now() at time zone 'Asia/Manila')::time;
  d_open    date := (now() at time zone 'Asia/Manila')::date + 7;
  d_weekly  date := (now() at time zone 'Asia/Manila')::date + 8;
  d_holiday date := (now() at time zone 'Asia/Manila')::date + 9;
  d_open2   date := (now() at time zone 'Asia/Manila')::date + 10;
  r json;
  v_booking uuid;
  v_start time;
begin
  update staff_groups set staff_count = 1 where name = 'nails';
  update salon_settings set require_code = false,
         closed_weekdays = array[extract(dow from d_weekly)::smallint];
  insert into closed_dates (closed_on, reason) values (d_holiday, 'Staff training');

  -- Closed days
  r := create_booking('Eve Test', '09170000011', null, 1, d_weekly, '10:00');
  perform pg_temp.ok(r->>'code' = 'closed' and r->>'message' = closed_reason(d_weekly),
    'create_booking refuses a weekly closed day with its reason');
  r := create_booking('Eve Test', '09170000011', null, 1, d_holiday, '10:00');
  perform pg_temp.ok(r->>'code' = 'closed' and r->>'message' = 'We''re closed that day (Staff training).',
    'create_booking refuses a holiday with its reason');
  r := get_available_slots(d_weekly, 1);
  perform pg_temp.ok((r->>'success')::boolean and (r->>'closed')::boolean
    and (r->>'open_count')::int = 0 and r->>'closed_reason' is not null,
    'get_available_slots reports a closed day');
  r := get_available_slots(d_open, 1);
  perform pg_temp.ok(not (r->>'closed')::boolean and (r->>'open_count')::int = 17,
    'get_available_slots reports an open day as not closed');

  r := create_booking('Fay Test', '09170000012', null, 1, d_open, '09:00');
  v_booking := (r->>'booking_id')::uuid;
  r := manage_booking('reschedule', '09170000012', null, v_booking, d_holiday, '10:00');
  perform pg_temp.ok(not (r->>'success')::boolean and r->>'message' = 'We''re closed that day (Staff training).',
    'rescheduling to a closed day is refused');

  -- Slot length
  update salon_settings set slot_minutes = 60;
  r := get_available_slots(d_open2, 1);
  perform pg_temp.ok((r->>'open_count')::int = 9, '60-minute slots give 9 start times from 09:00 to 18:00');
  perform pg_temp.ok(r->'available_times'->1->>'time' = '10:00', 'slots step by the slot length');
  update salon_settings set slot_minutes = 30;

  -- Walk-ins that already started today
  if v_now between '00:01' and '23:28' then
    update salon_settings set open_time = '00:00', close_time = '23:59';
    v_start := date_trunc('minute', v_now) - interval '1 minute';
    r := create_booking('Gia Walkin', '09170000013', null, 2, v_today, v_start, null, false, 'walk_in');
    perform pg_temp.ok((r->>'success')::boolean, 'walk-in that already started today is saved');
    r := create_booking('Gia Walkin', '09170000013', null, 2, v_today, v_start, null, false, 'website');
    perform pg_temp.ok(r->>'code' = 'in_past', 'the same time from the website is refused');
    update salon_settings set open_time = '09:00', close_time = '18:00';
  else
    raise notice 'skip: walk-in test needs a Manila time between 00:01 and 23:28';
  end if;
  r := create_booking('Gia Walkin', '09170000013', null, 2, v_today - 1, '10:00', null, false, 'walk_in');
  perform pg_temp.ok(r->>'code' = 'in_past', 'a walk-in for an earlier day is refused');

  -- Phone source
  r := create_booking('Hana Phone', '09170000014', null, 7, d_open, '11:00', null, false, 'phone');
  perform pg_temp.ok((select source from bookings where id = (r->>'booking_id')::uuid) = 'phone',
    'create_booking keeps source phone');

  -- Bookings keep their own duration and price
  r := create_booking('Ivy Pedi', '09170000015', null, 6, d_open, '13:00');
  v_booking := (r->>'booking_id')::uuid;
  update services set duration_minutes = 30, price = 999 where id = 6;
  r := create_booking('Joy Mani', '09170000016', null, 5, d_open, '13:30');
  perform pg_temp.ok(r->>'code' = 'slot_taken',
    'shortening a service does not shorten bookings already made');
  perform pg_temp.ok(
    (select duration_minutes = 60 and price = 350 and end_time = '14:00'::time
       from booking_details where booking_id = v_booking),
    'booking_details shows the duration and price the booking was made with');

  r := create_booking('Kim Pedi', '09170000017', null, 6, d_open, '16:30');
  v_booking := (r->>'booking_id')::uuid;
  update services set duration_minutes = 90 where id = 6;
  r := manage_booking('reschedule', '09170000017', null, v_booking, d_open, '17:00');
  perform pg_temp.ok((r->>'success')::boolean,
    'rescheduling uses the booking''s own duration, not the service''s new one');
  update services set duration_minutes = 60, price = 350 where id = 6;

  -- booking_details additions
  perform pg_temp.ok(
    (select staff_group = 'nails' and customer_id is not null and service_id = 6 and created_at is not null
       from booking_details where booking_id = v_booking),
    'booking_details has staff_group, customer_id, service_id and created_at');

  update salon_settings set require_code = true, closed_weekdays = '{}';
end;
$$;

select pg_temp.ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where relname = 'booking_details'),
  'booking_details obeys the access rules of its tables');
select pg_temp.ok(
  (select prosecdef from pg_proc where proname = 'get_available_slots'),
  'get_available_slots runs with owner rights so the public site can use it');

-- ---------------------------------------------------------------------------
-- Section 3: who can do what
-- ---------------------------------------------------------------------------
-- Fixtures, as the database owner
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'pending@example.com');
update staff_profiles set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a1';
update staff_profiles set role = 'staff' where user_id = '00000000-0000-0000-0000-0000000000a2';
update services set is_active = false where id = 8;
update salon_settings set require_code = false;
insert into closed_dates (closed_on, reason) values ((now() at time zone 'Asia/Manila')::date + 60, 'Holiday');
select create_booking('Lia Nails', '09170000021', null, 5, (now() at time zone 'Asia/Manila')::date + 12, '10:00');

-- Public website (anon)
set local role anon;
select pg_temp.ok((select count(*) > 0 and bool_and(is_active) from services), 'public sees active services only');
select pg_temp.ok((select count(*) from salon_settings) = 1, 'public reads opening hours');
select pg_temp.ok(exists (select 1 from closed_dates where reason = 'Holiday'), 'public reads closed dates');
select pg_temp.ok(
  (get_available_slots((now() at time zone 'Asia/Manila')::date + 12, 5)->>'open_count')::int = 14,
  'public open times account for existing bookings');
select pg_temp.fails($q$ select require_code from salon_settings $q$, 'public cannot read internal settings');
select pg_temp.fails($q$ select * from bookings $q$, 'public cannot read bookings');
select pg_temp.fails($q$ select * from customers $q$, 'public cannot read customers');
select pg_temp.fails($q$ select * from booking_details $q$, 'public cannot read booking_details');
select pg_temp.fails($q$ select * from staff_profiles $q$, 'public cannot read staff profiles');
select pg_temp.fails($q$ select * from verification_codes $q$, 'public cannot read verification codes');
select pg_temp.fails($q$ select create_booking('X Y', '09170000099', null, 1, current_date + 20, '10:00') $q$,
  'public cannot call create_booking directly');
select pg_temp.fails($q$ select manage_booking('list', '09170000021') $q$, 'public cannot call manage_booking');
select pg_temp.fails($q$ select staff_free_at(current_date, '10:00', 1) $q$, 'public cannot call staff_free_at');
select pg_temp.fails($q$ update services set price = 1 $q$, 'public cannot change services');
reset role;

-- Logged in but not approved (role none)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a3"}';
select pg_temp.ok((select count(*) from bookings) = 0, 'unapproved login sees no bookings');
select pg_temp.ok((select count(*) from customers) = 0, 'unapproved login sees no customers');
select pg_temp.ok((select count(*) from booking_details) = 0, 'unapproved login sees no booking_details');
select pg_temp.ok((select count(*) from services) = 0, 'unapproved login sees no services');
select pg_temp.ok((select count(*) from staff_profiles) = 1, 'unapproved login sees only its own profile');
select pg_temp.fails($q$ insert into customers (full_name, phone) values ('X', '09170000098') $q$,
  'unapproved login cannot add customers');
select pg_temp.ok(
  not (create_booking('X Y', '09170000097', null, 1, current_date + 20, '10:00')->>'success')::boolean,
  'unapproved login cannot book through create_booking');
reset role;

-- Staff
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2"}';
select pg_temp.ok((select count(*) from bookings) >= 2, 'staff see bookings');
select pg_temp.ok((select count(*) from booking_details) = (select count(*) from bookings),
  'staff see every booking in booking_details');
select pg_temp.ok((select count(*) from customers) >= 2, 'staff see customers');
select pg_temp.ok(exists (select 1 from services where not is_active), 'staff see all services, including hidden ones');
select pg_temp.ok(
  (create_booking('Mia Walkin', '09170000022', null, 1, (now() at time zone 'Asia/Manila')::date + 12,
                  '11:00', 'Short fringe', false, 'walk_in')->>'success')::boolean,
  'staff can add a walk-in booking');
update bookings set status = 'completed', notes = 'Done early'
 where id = '00000000-0000-0000-0000-00000000b001';
select pg_temp.ok(
  (select status = 'completed' and notes = 'Done early' from bookings where id = '00000000-0000-0000-0000-00000000b001'),
  'staff can change booking status and notes');
update customers set email = 'old@example.com' where phone = '09179999999';
select pg_temp.ok((select email from customers where phone = '09179999999') = 'old@example.com',
  'staff can edit customer details');
select pg_temp.fails($q$ update bookings set booking_date = current_date + 90 $q$, 'staff cannot move bookings by editing the date');
select pg_temp.fails($q$ delete from bookings $q$, 'staff cannot delete bookings');
select pg_temp.fails($q$ delete from customers $q$, 'staff cannot delete customers');
select pg_temp.fails($q$ insert into services (name, duration_minutes, price, staff_group) values ('X', 30, 1, 'hair') $q$,
  'staff cannot add services');
select pg_temp.fails($q$ insert into closed_dates (closed_on) values (current_date + 70) $q$, 'staff cannot add closures');
select pg_temp.fails($q$ select manage_booking('list', '09170000021') $q$, 'staff cannot call manage_booking');
select pg_temp.fails($q$ select check_verification_code('09170000021', '123456') $q$, 'staff cannot check SMS codes');
select pg_temp.fails($q$ select * from verification_codes $q$, 'staff cannot read verification codes');
update services set price = 1 where id = 1;
update staff_groups set staff_count = 9;
update salon_settings set slot_minutes = 15;
update staff_profiles set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select pg_temp.ok((select price from services where id = 1) = 450, 'staff edits to prices change nothing');
select pg_temp.ok((select staff_count from staff_groups where name = 'hair') = 2, 'staff edits to staff groups change nothing');
select pg_temp.ok((select slot_minutes from salon_settings) = 30, 'staff edits to settings change nothing');
select pg_temp.ok(
  (select role from staff_profiles where user_id = '00000000-0000-0000-0000-0000000000a2') = 'staff',
  'staff cannot promote themselves');

-- Owner
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1"}';
update services set price = 500 where id = 1;
insert into services (name, duration_minutes, price, staff_group, icon) values ('Blowout', 30, 300, 'hair', 'i-drop');
insert into staff_groups (name, staff_count) values ('lashes', 1);
update staff_groups set staff_count = 3 where name = 'hair';
update salon_settings set slot_minutes = 45, closed_weekdays = '{1}';
insert into closed_dates (closed_on, reason) values (current_date + 80, 'Fiesta');
delete from closed_dates where closed_on = current_date + 80;
update staff_profiles set role = 'staff' where user_id = '00000000-0000-0000-0000-0000000000a3';
update staff_profiles set role = 'none' where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.ok(
  (select count(*) from staff_profiles where user_id in ('00000000-0000-0000-0000-0000000000a1',
     '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')) = 3,
  'owner sees every login');
reset role;
select pg_temp.ok((select price from services where id = 1) = 500, 'owner can change prices');
select pg_temp.ok(exists (select 1 from services where name = 'Blowout'), 'owner can add services');
select pg_temp.ok((select staff_count from staff_groups where name = 'hair') = 3, 'owner can change staff counts');
select pg_temp.ok(exists (select 1 from staff_groups where name = 'lashes'), 'owner can add staff groups');
select pg_temp.ok((select slot_minutes = 45 and closed_weekdays = '{1}' from salon_settings), 'owner can change hours settings');
select pg_temp.ok(not exists (select 1 from closed_dates where closed_on = current_date + 80), 'owner can add and remove closures');
select pg_temp.ok(
  (select role from staff_profiles where user_id = '00000000-0000-0000-0000-0000000000a3') = 'staff',
  'owner can approve a login as staff');
select pg_temp.ok(
  (select role from staff_profiles where user_id = '00000000-0000-0000-0000-0000000000a1') = 'owner',
  'owner cannot remove their own owner role');

-- n8n (service key)
set local role service_role;
select pg_temp.ok((manage_booking('list', '09170000021')->>'success')::boolean, 'n8n can still use manage_booking');
select pg_temp.ok(
  (create_booking('Noa Chat', '09170000023', null, 2, (now() at time zone 'Asia/Manila')::date + 12,
                  '15:00', null, false, 'ai_chat')->>'success')::boolean,
  'n8n can still book through create_booking');
reset role;

rollback;
