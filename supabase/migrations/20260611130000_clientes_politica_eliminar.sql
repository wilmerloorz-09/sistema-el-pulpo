-- Permite eliminar comensales a usuarios con turno operativo abierto.

DROP POLICY IF EXISTS clientes_delete_turno_abierto ON public.clientes;
CREATE POLICY clientes_delete_turno_abierto
  ON public.clientes
  FOR DELETE
  TO authenticated
  USING (public.usuario_en_turno_operativo_abierto(auth.uid()));

NOTIFY pgrst, 'reload schema';
