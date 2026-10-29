-- Catálogo pescado fresco: Bonito (default) y Albacora.

UPDATE public.pescado_fresco_productos
SET activo = false, actualizado_en = now()
WHERE codigo = 'PESCADO_FRESCO';

INSERT INTO public.pescado_fresco_productos (codigo, nombre, activo)
VALUES
  ('BONITO', 'Bonito', true),
  ('ALBACORA', 'Albacora', true)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  activo = true,
  actualizado_en = now();

INSERT INTO public.pescado_fresco_stock (producto_id, cantidad_lb)
SELECT p.id, 0
FROM public.pescado_fresco_productos p
WHERE p.codigo IN ('BONITO', 'ALBACORA')
ON CONFLICT (producto_id) DO NOTHING;
