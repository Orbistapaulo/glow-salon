-- Data that exists before the CRM migration runs, so the tests can check how the
-- migration treats it. A Hair Color booking 30 days out.
insert into customers (id, full_name, phone)
values ('00000000-0000-0000-0000-00000000c001', 'Old Customer', '09179999999');

insert into bookings (id, customer_id, service_id, booking_date, start_time, status)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 3,
        (now() at time zone 'Asia/Manila')::date + 30, '10:00', 'confirmed');
