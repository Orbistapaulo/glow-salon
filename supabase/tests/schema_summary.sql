-- One-cell summary of the public schema: tables, columns, constraints, policies,
-- triggers and function source. Read-only. Run it on two projects and compare the
-- output to confirm they match.
with cols as (
  select table_name::text as t,
         string_agg(column_name::text || ' ' || data_type::text
                    || case when data_type::text = 'numeric' and numeric_precision is not null
                            then format('(%s,%s)', numeric_precision, numeric_scale) else '' end
                    || case when is_nullable::text = 'NO' then ' not null' else '' end
                    || coalesce(' default ' || column_default::text, ''),
                    E'\n  ' order by ordinal_position) as body
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
),
rls as (
  select relname::text as t, relrowsecurity as rls_on
  from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
),
cons as (
  select conrelid::regclass::text as t,
         string_agg(conname::text || ': ' || pg_get_constraintdef(oid), E'\n  ' order by conname) as body
  from pg_constraint
  where connamespace = 'public'::regnamespace
  group by conrelid
),
pols as (
  select tablename::text as t,
         string_agg(policyname::text || ' [' || cmd || ' to ' || array_to_string(roles, ',') || ']'
                    || coalesce(' using (' || qual || ')', '')
                    || coalesce(' check (' || with_check || ')', ''),
                    E'\n  ' order by policyname) as body
  from pg_policies
  where schemaname = 'public'
  group by tablename
),
fns as (
  select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) as body
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
trgs as (
  select string_agg(t.tgname::text || ' on ' || t.tgrelid::regclass::text || ' -> ' || t.tgfoid::regproc::text, E'\n  ') as body
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
)
select
  (select string_agg(
            case when r.t is null then 'VIEW ' else 'TABLE ' end || c.t
            || case when r.t is null then '' when r.rls_on then ' (RLS on)' else ' (RLS OFF)' end
            || E'\n  ' || c.body,
            E'\n\n' order by c.t)
     from cols c left join rls r on r.t = c.t)
  || E'\n\nCONSTRAINTS\n' || coalesce((select string_agg(t || E':\n  ' || body, E'\n' order by t) from cons), '  none')
  || E'\n\nPOLICIES\n' || coalesce((select string_agg(t || E':\n  ' || body, E'\n' order by t) from pols), '  none')
  || E'\n\nTRIGGERS\n  ' || coalesce((select body from trgs), 'none')
  || E'\n\nFUNCTIONS\n' || coalesce((select body from fns), '  none')
  as schema_summary;
