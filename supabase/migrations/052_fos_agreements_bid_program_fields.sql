-- Feature 049: Bid / Program / Initial Planned Hours on Agreements
-- Mirrors new Fibery Agreement Management/Agreements fields into Datastore
-- and adds fos_programs for Program entity joins.

begin;

create table if not exists public.fos_programs (
  fibery_id text primary key,
  public_id text,
  name text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_programs_name_idx on public.fos_programs (name);
create index if not exists fos_programs_public_id_idx on public.fos_programs (public_id);

comment on table public.fos_programs is
  'Fibery Agreement Management/Program entities mirrored for agreement program joins.';

alter table public.fos_agreements
  add column if not exists bid_cost numeric,
  add column if not exists bid_margin numeric,
  add column if not exists bid_revenue numeric,
  add column if not exists initial_planned_hours numeric,
  add column if not exists program_id text,
  add column if not exists program_name text;

create index if not exists fos_agreements_program_idx
  on public.fos_agreements (program_id);

comment on column public.fos_agreements.bid_cost is 'Fibery Agreement Management/Bid Cost';
comment on column public.fos_agreements.bid_margin is 'Fibery Agreement Management/Bid Margin (formula)';
comment on column public.fos_agreements.bid_revenue is 'Fibery Agreement Management/Bid Revenue';
comment on column public.fos_agreements.initial_planned_hours is 'Fibery Agreement Management/Initial Planned Hours';
comment on column public.fos_agreements.program_id is 'Fibery Agreement Management/Program relation id';
comment on column public.fos_agreements.program_name is 'Program display name (Program Name lookup, else relation Name)';

grant all on table public.fos_programs to postgres, service_role, anon, authenticated;

commit;
