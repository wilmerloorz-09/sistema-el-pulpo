-- Alinear RLS de bancos con el resto del catalogo global (denominations, etc.).
-- Renombrada desde 20260713120000 para aplicarse despues de migraciones ya presentes en remoto.

DROP POLICY IF EXISTS "Global Admin manage bancos" ON public.bancos;
CREATE POLICY "Global Admin manage bancos"
  ON public.bancos FOR ALL TO authenticated
  USING (public.is_global_admin(auth.uid()))
  WITH CHECK (public.is_global_admin(auth.uid()));

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
