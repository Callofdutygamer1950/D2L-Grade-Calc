-- D2L Grade Calculator: shared weights and groups.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- What gets stored: course identifiers (D2L host, course ID, course code, term),
-- a random anonymous install ID, and the setup itself:
--   { "weights": { "Quizzes": 20, ... }, "groups": { "HW01": "HW", ... } }
-- No names, emails, scores or grades are ever sent.
--
-- The extension never touches the table directly. It can only call the two
-- functions at the bottom, which validate everything that comes in.

create table if not exists public.shared_setups (
  host        text not null check (host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.(desire2learn|brightspace)\.com$'),
  ou          text not null check (ou ~ '^[0-9]{1,12}$'),
  course_code text          check (course_code is null or course_code ~ '^[A-Z]{2,6}-[0-9]{3,4}[A-Z]?$'),
  term        text          check (term is null or term ~ '^[0-9]{4,8}$'),
  install_id  uuid not null,
  setup       jsonb not null,
  setup_hash  text not null,
  updated_at  timestamptz not null default now(),
  primary key (host, ou, install_id)
);

create index if not exists shared_setups_course_idx on public.shared_setups (host, course_code, term);

-- Row level security on with no policies = nobody can read or write the table directly.
alter table public.shared_setups enable row level security;
revoke all on public.shared_setups from anon, authenticated;

-- ---------- Validation ----------

create or replace function public.valid_setup(s jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  total numeric := 0;
begin
  if jsonb_typeof(s) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(s) key where key not in ('weights', 'groups')) then return false; end if;
  if jsonb_typeof(coalesce(s->'weights', '{}')) <> 'object' then return false; end if;
  if jsonb_typeof(coalesce(s->'groups', '{}')) <> 'object' then return false; end if;
  if length(s::text) > 20000 then return false; end if;

  -- weights: up to 60 categories, each 0 < w <= 100, names up to 120 chars, total <= 150
  if (select count(*) from jsonb_object_keys(coalesce(s->'weights', '{}'))) > 60 then return false; end if;
  for k, v in select * from jsonb_each(coalesce(s->'weights', '{}')) loop
    if length(k) = 0 or length(k) > 120 then return false; end if;
    if jsonb_typeof(v) <> 'number' then return false; end if;
    if (v::text)::numeric <= 0 or (v::text)::numeric > 100 then return false; end if;
    total := total + (v::text)::numeric;
  end loop;
  if total > 150 then return false; end if;

  -- groups: up to 300 items, item -> group name, both up to 120 chars
  if (select count(*) from jsonb_object_keys(coalesce(s->'groups', '{}'))) > 300 then return false; end if;
  for k, v in select * from jsonb_each(coalesce(s->'groups', '{}')) loop
    if length(k) = 0 or length(k) > 120 then return false; end if;
    if jsonb_typeof(v) <> 'string' then return false; end if;
    if length(v #>> '{}') = 0 or length(v #>> '{}') > 120 then return false; end if;
  end loop;

  return true;
end;
$$;

-- ---------- Submit (insert / replace / delete this install's setup) ----------

create or replace function public.submit_setup(
  p_host text, p_ou text, p_course_code text, p_term text, p_install_id uuid, p_setup jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned jsonb;
begin
  cleaned := jsonb_strip_nulls(jsonb_build_object(
    'weights', nullif(coalesce(p_setup->'weights', '{}'), '{}'::jsonb),
    'groups',  nullif(coalesce(p_setup->'groups',  '{}'), '{}'::jsonb)
  ));

  -- Nothing left to share: remove this install's entry for the course.
  if cleaned = '{}'::jsonb then
    delete from shared_setups where host = p_host and ou = p_ou and install_id = p_install_id;
    return;
  end if;

  if not valid_setup(cleaned) then
    raise exception 'invalid setup';
  end if;

  -- Light abuse limit: one install can share setups for at most 40 courses.
  if (select count(*) from shared_setups where install_id = p_install_id
        and not (host = p_host and ou = p_ou)) >= 40 then
    raise exception 'too many courses for this install';
  end if;

  insert into shared_setups (host, ou, course_code, term, install_id, setup, setup_hash, updated_at)
  values (p_host, p_ou, p_course_code, p_term, p_install_id, cleaned, md5(cleaned::text), now())
  on conflict (host, ou, install_id) do update
    set setup = excluded.setup,
        setup_hash = excluded.setup_hash,
        course_code = excluded.course_code,
        term = excluded.term,
        updated_at = now();
end;
$$;

-- ---------- Fetch the most popular setup ----------
-- Exact section first; if nobody shared it, the most popular setup from another
-- section of the same course in the same term (scope = 'course').

create or replace function public.get_shared_setup(
  p_host text, p_ou text, p_course_code text, p_term text
)
returns table (setup jsonb, students integer, scope text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select (array_agg(s.setup))[1], count(*)::integer, 'section'::text
    from shared_setups s
    where s.host = p_host and s.ou = p_ou
    group by s.setup_hash
    order by count(*) desc, max(s.updated_at) desc
    limit 1;
  if found then return; end if;

  if p_course_code is null or p_term is null then return; end if;

  return query
    select (array_agg(s.setup))[1], count(*)::integer, 'course'::text
    from shared_setups s
    where s.host = p_host and s.course_code = p_course_code and s.term = p_term and s.ou <> p_ou
    group by s.setup_hash
    order by count(*) desc, max(s.updated_at) desc
    limit 1;
end;
$$;

-- Only these two functions are callable with the public (anon) key.
revoke all on function public.valid_setup(jsonb) from public, anon, authenticated;
revoke all on function public.submit_setup(text, text, text, text, uuid, jsonb) from public;
revoke all on function public.get_shared_setup(text, text, text, text) from public;
grant execute on function public.submit_setup(text, text, text, text, uuid, jsonb) to anon;
grant execute on function public.get_shared_setup(text, text, text, text) to anon;
