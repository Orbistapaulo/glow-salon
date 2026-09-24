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

rollback;
