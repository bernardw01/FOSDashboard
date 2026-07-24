-- Feature 036 cutover: soft-to-hard FK constraints for the core Agreement
-- Management mirror graph (see 041_agreement_management_mirror.sql).
-- All FKs are DEFERRABLE INITIALLY DEFERRED so hydrate can upsert dimension
-- rows and fact rows in the same page without a strict topological order.
-- ON DELETE SET NULL is used everywhere (soft dimension deletes should not
-- cascade-delete facts); junction-table FKs use ON DELETE CASCADE since a
-- junction row is meaningless once either side is gone.
--
-- Does NOT touch fos_am_labor_costs (deprecated; Fibery Labor Costs are not
-- mirrored as of v3.4.0 - labor facts are Clockify-owned via fos_labor_costs).
-- If a FK would fail validation against existing dirty data, it is added
-- NOT VALID (accepted for new/updated rows immediately) and left unvalidated
-- here; run a follow-up `VALIDATE CONSTRAINT` once the mirror has a clean
-- backfill.

begin;

-- ---------------------------------------------------------------------------
-- fos_agreements -> fos_companies / fos_clockify_users
-- ---------------------------------------------------------------------------
alter table public.fos_agreements
  add constraint fos_agreements_customer_id_fkey
    foreign key (customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_agreements
  add constraint fos_agreements_assigned_owner_id_fkey
    foreign key (assigned_owner_id) references public.fos_clockify_users (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_contacts -> fos_companies
-- ---------------------------------------------------------------------------
alter table public.fos_contacts
  add constraint fos_contacts_customer_id_fkey
    foreign key (customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_resource_allocations -> fos_agreements / fos_clockify_users / fos_team_member_roles
-- ---------------------------------------------------------------------------
alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_clockify_user_id_fkey
    foreign key (clockify_user_id) references public.fos_clockify_users (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_role_id_fkey
    foreign key (clockify_user_role_id) references public.fos_team_member_roles (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_revenue_items -> fos_agreements / fos_invoice_requests / fos_companies
-- ---------------------------------------------------------------------------
alter table public.fos_revenue_items
  add constraint fos_revenue_items_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_revenue_items
  add constraint fos_revenue_items_invoice_request_id_fkey
    foreign key (invoice_request_id) references public.fos_invoice_requests (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_revenue_items
  add constraint fos_revenue_items_agreement_customer_id_fkey
    foreign key (agreement_customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_other_direct_costs -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_other_direct_costs
  add constraint fos_other_direct_costs_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_invoice_requests -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_invoice_requests
  add constraint fos_invoice_requests_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_status_updates -> fos_agreements
-- Soft reference only: Delivery status dual-write may insert before AM mirror
-- has the agreement row. Do not add a hard FK here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- fos_agreement_pnl_items -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_agreement_pnl_items
  add constraint fos_agreement_pnl_items_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_company_segments -> fos_companies (junction; cascade both directions)
-- ---------------------------------------------------------------------------
alter table public.fos_company_segments
  add constraint fos_company_segments_company_fkey
    foreign key (company_fibery_id) references public.fos_companies (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_agreement_assigned_resources -> fos_agreements / fos_clockify_users (junction)
-- ---------------------------------------------------------------------------
alter table public.fos_agreement_assigned_resources
  add constraint fos_agreement_assigned_resources_agreement_fkey
    foreign key (agreement_fibery_id) references public.fos_agreements (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

alter table public.fos_agreement_assigned_resources
  add constraint fos_agreement_assigned_resources_user_fkey
    foreign key (clockify_user_fibery_id) references public.fos_clockify_users (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_pnl_revenue_items -> fos_agreement_pnl_items / fos_revenue_items (junction)
-- ---------------------------------------------------------------------------
alter table public.fos_pnl_revenue_items
  add constraint fos_pnl_revenue_items_pnl_fkey
    foreign key (pnl_fibery_id) references public.fos_agreement_pnl_items (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

alter table public.fos_pnl_revenue_items
  add constraint fos_pnl_revenue_items_revenue_item_fkey
    foreign key (revenue_item_fibery_id) references public.fos_revenue_items (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

comment on table public.fos_am_labor_costs is
  'DEPRECATED (v3.4.0): Fibery Labor Costs are no longer mirrored. Labor facts '
  'come only from Clockify via fos_labor_costs. This table receives no new '
  'rows from supabaseAmMirror.js and is not FK-constrained. Safe to drop in a '
  'future migration once confirmed unused by any report or export.';

commit;
