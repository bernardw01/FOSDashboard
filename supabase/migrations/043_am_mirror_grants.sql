-- Feature 036 follow-up: Agreement Management mirror table grants
-- Migration 041 revoked anon/authenticated from AM mirror tables. Working Hub
-- tables (fos_panel_payloads, fos_agreements, fos_companies) and engagement
-- reviews (040) grant anon/authenticated as well so PostgREST upserts from
-- Apps Script succeed. Align AM mirror privileges with that pattern.
-- Prefer SUPABASE_SERVICE_ROLE_KEY = service_role secret.

grant all on table public.fos_am_enums to postgres, service_role, anon, authenticated;
grant all on table public.fos_team_member_roles to postgres, service_role, anon, authenticated;
grant all on table public.fos_company_segments to postgres, service_role, anon, authenticated;
grant all on table public.fos_clockify_users to postgres, service_role, anon, authenticated;
grant all on table public.fos_contacts to postgres, service_role, anon, authenticated;
grant all on table public.fos_services_estimates to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_assigned_resources to postgres, service_role, anon, authenticated;
grant all on table public.fos_resource_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_estimated_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_am_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_other_direct_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_invoice_requests to postgres, service_role, anon, authenticated;
grant all on table public.fos_revenue_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_pnl_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_revenue_items to postgres, service_role, anon, authenticated;
