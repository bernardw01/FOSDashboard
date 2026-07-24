-- Feature 037 follow-up: Engagement Review table grants
-- Match privilege pattern of working fos_* Hub tables from 036
-- (service_role for Apps Script; anon/authenticated present on sibling tables).

grant all on table public.fos_engagement_reviews to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_agreements to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_participants to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_updates to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_recordings to postgres, service_role, anon, authenticated;
