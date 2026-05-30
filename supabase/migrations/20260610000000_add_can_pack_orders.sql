-- Agregar el permiso de empacador a la tabla de usuarios del turno
ALTER TABLE public.cash_shift_users
ADD COLUMN IF NOT EXISTS can_pack_orders boolean NOT NULL DEFAULT false;

-- Notificar a postgREST para que recargue el esquema
NOTIFY pgrst, 'reload schema';
