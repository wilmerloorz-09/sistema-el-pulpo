-- =============================================================================
-- SCRIPT DE LIMPIEZA: Eliminar usuarios de seed creados sin autorización
-- Fecha: 2026-06-17
--
-- INSTRUCCIONES:
--  1. Primero ejecutar el SELECT de inspección para revisar qué usuarios se eliminarán
--  2. Si estás conforme, ejecutar el bloque DELETE (descomentar)
--  3. Este script debe ejecutarse en Supabase SQL Editor por el Superadmin
--
-- IMPORTANTE: Este script NO elimina usuarios protegidos (is_protected_superadmin = true)
-- =============================================================================

-- ── PASO 1: Inspeccionar usuarios sospechosos ────────────────────────────────
-- Ejecuta esto primero para ver qué se va a eliminar
SELECT
  p.id,
  p.full_name,
  p.username,
  p.email,
  p.created_at,
  p.is_active,
  p.is_protected_superadmin
FROM public.profiles p
WHERE (
  p.email      ILIKE '%@elpulpo.com'
  OR p.username ILIKE 'mesero%'
  OR p.username ILIKE 'cajero%'
  OR p.username ILIKE 'cocina%'
  OR p.username = 'superuser'
  OR p.full_name ILIKE 'workflow%'
  OR p.full_name ILIKE 'gas%'
  OR p.full_name ILIKE 'grader%'
  OR p.full_name ILIKE 'usuario de%'
  OR p.username ILIKE 'workflow%'
)
AND p.is_protected_superadmin = false
ORDER BY p.created_at DESC;

-- ── PASO 2: Ver el turno abierto y quién lo abrió ────────────────────────────
SELECT
  cs.id          AS shift_id,
  cs.status,
  cs.opened_at,
  cs.cashier_id,
  p.full_name    AS opened_by_name,
  p.username     AS opened_by_username,
  p.email        AS opened_by_email,
  b.name         AS branch_name
FROM public.cash_shifts cs
JOIN public.profiles p ON p.id = cs.cashier_id
JOIN public.branches  b ON b.id = cs.branch_id
WHERE cs.status = 'OPEN'
ORDER BY cs.opened_at DESC;

-- ── PASO 3: Ver los usuarios habilitados en el turno abierto ─────────────────
SELECT
  csu.shift_id,
  p.full_name,
  p.username,
  p.email,
  csu.is_enabled,
  csu.can_serve_tables,
  csu.can_use_caja,
  csu.is_supervisor,
  csu.created_at AS enabled_at
FROM public.cash_shift_users csu
JOIN public.cash_shifts cs  ON cs.id = csu.shift_id
JOIN public.profiles p      ON p.id  = csu.user_id
WHERE cs.status = 'OPEN'
ORDER BY csu.is_enabled DESC, p.full_name;

-- ── PASO 4 (OPCIONAL): Deshabilitar usuarios sospechosos del turno activo ────
-- Descomentar solo si se confirma que los usuarios son no deseados en el turno

/*
UPDATE public.cash_shift_users csu
SET is_enabled = false
FROM public.cash_shifts cs
JOIN public.profiles p ON p.id = csu.user_id
WHERE cs.id = csu.shift_id
  AND cs.status = 'OPEN'
  AND (
    p.email      ILIKE '%@elpulpo.com'
    OR p.username ILIKE 'mesero%'
    OR p.username ILIKE 'cajero%'
    OR p.username ILIKE 'cocina%'
    OR p.username = 'superuser'
    OR p.full_name ILIKE 'workflow%'
    OR p.full_name ILIKE 'gas%'
    OR p.full_name ILIKE 'grader%'
    OR p.full_name ILIKE 'usuario de%'
    OR p.username ILIKE 'workflow%'
  );
*/

-- ── PASO 5 (OPCIONAL): Eliminar usuarios sospechosos de auth.users ────────────
-- ADVERTENCIA: Esta operación es irreversible
-- Solo ejecutar después de confirmar el PASO 1

/*
DO $$
DECLARE
  v_user_id uuid;
  v_deleted_count integer := 0;
BEGIN
  FOR v_user_id IN
    SELECT p.id
    FROM public.profiles p
    WHERE (
      p.email      ILIKE '%@elpulpo.com'
      OR p.username ILIKE 'mesero%'
      OR p.username ILIKE 'cajero%'
      OR p.username ILIKE 'cocina%'
      OR p.username = 'superuser'
      OR p.full_name ILIKE 'workflow%'
      OR p.full_name ILIKE 'gas%'
      OR p.full_name ILIKE 'grader%'
      OR p.full_name ILIKE 'usuario de%'
      OR p.username ILIKE 'workflow%'
    )
    AND p.is_protected_superadmin = false
  LOOP
    DELETE FROM auth.users WHERE id = v_user_id;
    v_deleted_count := v_deleted_count + 1;
    RAISE NOTICE 'Usuario eliminado: %', v_user_id;
  END LOOP;

  RAISE NOTICE 'Total de usuarios eliminados: %', v_deleted_count;
END;
$$;
*/
