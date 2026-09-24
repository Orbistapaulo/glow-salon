-- Seed data for a test database: services, staff groups and settings, no customers.
-- Services match the list in index.htm. The staff group names and counts are a
-- stand-in: replace them with the live rows before seeding a Supabase test project.

insert into staff_groups (name, staff_count) values
  ('hair', 2),
  ('nails', 1),
  ('spa', 1);

insert into services (id, name, duration_minutes, price, staff_group) values
  (1, 'Haircut (Women)',   60,  450,  'hair'),
  (2, 'Haircut (Men)',     30,  250,  'hair'),
  (3, 'Hair Color',        120, 1800, 'hair'),
  (4, 'Hair Rebond',       180, 2500, 'hair'),
  (5, 'Manicure',          45,  300,  'nails'),
  (6, 'Pedicure',          60,  350,  'nails'),
  (7, 'Foot Spa',          60,  400,  'spa'),
  (8, 'Full Body Massage', 60,  700,  'spa');

insert into salon_settings (id) values (1);
