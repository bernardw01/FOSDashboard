-- Resource allocations: denormalized Clockify user email from Fibery
-- (Agreement Management/Clockify User Clockify User Email) for labor joins.

alter table public.fos_resource_allocations
  add column if not exists clockify_user_email text;

create index if not exists fos_resource_allocations_user_email_idx
  on public.fos_resource_allocations (lower(clockify_user_email));

comment on column public.fos_resource_allocations.clockify_user_email is
  'Lowercased harpin email from Fibery Clockify User (formula field). Primary join key to fos_labor_costs.user_id.';

-- Backfill from mirrored Clockify Users when the allocation row already links by fibery id.
update public.fos_resource_allocations ra
set clockify_user_email = lower(trim(u.clockify_user_email))
from public.fos_clockify_users u
where ra.clockify_user_id = u.fibery_id
  and ra.clockify_user_email is null
  and u.clockify_user_email is not null
  and trim(u.clockify_user_email) <> '';
