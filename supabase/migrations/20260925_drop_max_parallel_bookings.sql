-- Removes the unused salon-wide capacity setting. Capacity is per staff group.
-- Run only after checking that no n8n workflow reads max_parallel_bookings.
alter table salon_settings drop column if exists max_parallel_bookings;
