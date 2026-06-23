-- =============================================================================
-- Seguridad: habilitar RLS en entity_counters (tabla interna de secuencias)
-- =============================================================================
-- Supabase Security Advisor: rls_disabled_in_public
-- Solo funciones SECURITY DEFINER (next_human_sequence, etc.) acceden a esta tabla.
-- Sin políticas para anon/authenticated = acceso directo vía PostgREST bloqueado.
-- =============================================================================

ALTER TABLE public.entity_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.entity_counters FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
