-- ============================================================
-- 05-views.sql
-- Database views
-- ============================================================

CREATE VIEW public.public_profiles AS
SELECT 
    id, 
    full_name, 
    avatar_url 
FROM public.profiles;
