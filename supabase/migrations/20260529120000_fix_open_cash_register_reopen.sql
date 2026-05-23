-- Eliminar la restricción única incorrecta que ataba las denominaciones al (turno, cajero) globalmente.
-- Esto causaba que un cajero no pudiera abrir y cerrar su caja más de una vez en el mismo turno global
-- sin chocar con las denominaciones de su apertura anterior.
DROP INDEX IF EXISTS public.ux_cash_shift_denoms_per_cashier;

-- Crear la restricción correcta: Las denominaciones son únicas por APERTURA DE CAJA (opening_id).
-- Cada vez que el cajero "Abre caja", se genera un nuevo opening_id, por lo que sus monedas empiezan desde cero
-- y son totalmente independientes de aperturas anteriores.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_shift_denoms_per_opening
  ON public.cash_shift_denoms (opening_id, denomination_id)
  WHERE opening_id IS NOT NULL;

-- Notificamos a PostgREST para que recargue el esquema y aplique el cambio inmediatamente
NOTIFY pgrst, 'reload schema';
