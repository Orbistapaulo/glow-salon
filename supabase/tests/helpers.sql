-- Test helpers, created per session in pg_temp. Include with: \ir helpers.sql
-- pg_temp.ok(cond, label): passes when cond is true, otherwise stops the run.
-- pg_temp.fails(sql, label): passes when the SQL raises an error.

create or replace function pg_temp.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAILED: %', label;
  end if;
  raise notice 'ok: %', label;
end;
$$;

create or replace function pg_temp.fails(sql text, label text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok: % [%]', label, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (expected an error, got none)', label;
end;
$$;
