-- Modificar políticas RLS de clientes para permitir lectura/escritura a Administradores Generales
-- sin necesidad de tener un turno abierto.

DROP POLICY IF EXISTS clientes_select_turno_abierto ON public.clientes;
CREATE POLICY clientes_select_turno_abierto
  ON public.clientes
  FOR SELECT
  TO authenticated
  USING (
    public.usuario_en_turno_operativo_abierto(auth.uid()) 
    OR public.is_global_admin(auth.uid())
  );

DROP POLICY IF EXISTS clientes_insert_turno_abierto ON public.clientes;
CREATE POLICY clientes_insert_turno_abierto
  ON public.clientes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()))
    AND (creado_por IS NULL OR creado_por = auth.uid())
  );

DROP POLICY IF EXISTS clientes_update_turno_abierto ON public.clientes;
CREATE POLICY clientes_update_turno_abierto
  ON public.clientes
  FOR UPDATE
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()))
  WITH CHECK (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS clientes_delete_turno_abierto ON public.clientes;
CREATE POLICY clientes_delete_turno_abierto
  ON public.clientes
  FOR DELETE
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()) OR public.is_global_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
