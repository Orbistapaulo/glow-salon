-- Behaviour of the live schema before the CRM changes. Runs as the database owner
-- (like n8n with the service key). Everything is rolled back at the end.
\ir helpers.sql

begin;

update staff_groups set staff_count = 1 where name = 'nails';

do $$
declare
  d date := (now() at time zone 'Asia/Manila')::date + 7;
  r json;
  first_id uuid;
begin
  r := create_booking('Ana Test', '09170000001', null, 5, d, '10:00');
  perform pg_temp.ok((r->>'success')::boolean, 'website booking succeeds');
  first_id := (r->>'booking_id')::uuid;

  r := create_booking('Bea Test', '09170000002', null, 6, d, '10:30');
  perform pg_temp.ok(r->>'code' = 'slot_taken', 'overlapping booking in a 1-person group is refused');

  r := create_booking('Cara Test', '09170000003', null, 4, d, '16:00');
  perform pg_temp.ok(r->>'code' = 'outside_hours', 'booking that ends after closing is refused');

  r := create_booking('Dina Test', '09170000004', null, 1, d - 8, '10:00');
  perform pg_temp.ok(r->>'code' = 'in_past', 'booking in the past is refused');

  r := get_available_slots(d + 1, 1);
  perform pg_temp.ok((r->>'open_count')::int = 17, '60-minute service has 17 start times on an empty open day');

  perform pg_temp.ok(
    (select end_time from booking_details where booking_id = first_id) = '10:45'::time,
    'booking_details shows the end time');
end;
$$;

rollback;
