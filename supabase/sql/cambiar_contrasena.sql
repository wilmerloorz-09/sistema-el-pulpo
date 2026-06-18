-- =============================================================================
-- SCRIPT: Cambiar contraseña de usuario
-- Carpeta: supabase/sql/cambiar_contrasena.sql
-- Uso: Ejecutar en Supabase SQL Editor (requiere rol postgres/service_role)
-- =============================================================================

-- ─── INSTRUCCIONES ────────────────────────────────────────────────────────────
-- 1. Busca el bloque del usuario que quieres cambiar
-- 2. Reemplaza la nueva contraseña donde dice 'NUEVA_CONTRASENA_AQUI'
-- 3. Ejecuta SOLO el bloque que necesitas (no todo el archivo)
-- 4. La contraseña debe tener al menos 10 caracteres, letras y números
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1: Cambiar contraseña por EMAIL
-- ══════════════════════════════════════════════════════════════════════════════
/*
  Reemplaza:
    'correo@ejemplo.com'   → el email del usuario
    'NUEVA_CONTRASENA_AQUI' → la nueva contraseña (mín. 10 chars, letras+números)
*/
UPDATE auth.users
SET encrypted_password = crypt('NUEVA_CONTRASENA_AQUI', gen_salt('bf'))
WHERE email = 'correo@ejemplo.com';

-- Verificar que se actualizó (debe devolver 1 fila):
SELECT id, email, updated_at
FROM auth.users
WHERE email = 'correo@ejemplo.com';


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2: Cambiar contraseña por USERNAME
-- ══════════════════════════════════════════════════════════════════════════════
/*
  Reemplaza:
    'nombre_usuario'        → el username del usuario (tabla profiles)
    'NUEVA_CONTRASENA_AQUI' → la nueva contraseña
*/
UPDATE auth.users u
SET encrypted_password = crypt('NUEVA_CONTRASENA_AQUI', gen_salt('bf'))
FROM public.profiles p
WHERE p.id = u.id
  AND p.username = 'nombre_usuario';

-- Verificar:
SELECT u.id, u.email, p.username, u.updated_at
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE p.username = 'nombre_usuario';


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3: Cambiar contraseña Y cerrar todas las sesiones activas
--           (usar cuando sospechas que alguien más tiene acceso)
-- ══════════════════════════════════════════════════════════════════════════════
/*
  Reemplaza:
    'correo@ejemplo.com'    → email del usuario comprometido
    'NUEVA_CONTRASENA_AQUI' → nueva contraseña segura
*/
DO $$
DECLARE
  v_user_id uuid;
  v_sessions_deleted integer;
BEGIN
  -- Obtener el ID del usuario
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'correo@ejemplo.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado con ese email';
  END IF;

  -- Cambiar contraseña
  UPDATE auth.users
  SET encrypted_password = crypt('NUEVA_CONTRASENA_AQUI', gen_salt('bf'))
  WHERE id = v_user_id;

  -- Cerrar todas las sesiones activas
  DELETE FROM auth.sessions WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

  RAISE NOTICE '✅ Contraseña actualizada para: %', v_user_id;
  RAISE NOTICE '🔒 Sesiones cerradas: %', v_sessions_deleted;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4: Cambiar contraseña del ADMIN PRINCIPAL (admin1)
--           (acceso rápido para el caso más común)
-- ══════════════════════════════════════════════════════════════════════════════
/*
  Solo cambia 'NUEVA_CONTRASENA_AQUI' y ejecuta este bloque.
  Requisitos: mínimo 10 caracteres, debe combinar letras y números.
  
  Ejemplo de buenas contraseñas:
    ElPulpo2026#
    Chone2026Admin!
    POS#Sistema99
*/
DO $$
DECLARE
  v_user_id uuid;
  v_nueva_password text := 'NUEVA_CONTRASENA_AQUI'; -- ← CAMBIA ESTO
BEGIN
  -- Validaciones básicas
  IF length(v_nueva_password) < 10 THEN
    RAISE EXCEPTION '❌ La contraseña debe tener al menos 10 caracteres';
  END IF;

  IF v_nueva_password ~ '^\d+$' OR v_nueva_password ~ '^[a-zA-Z]+$' THEN
    RAISE EXCEPTION '❌ La contraseña debe combinar letras y números';
  END IF;

  IF v_nueva_password = 'NUEVA_CONTRASENA_AQUI' THEN
    RAISE EXCEPTION '❌ Debes reemplazar NUEVA_CONTRASENA_AQUI con tu contraseña real';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'admin1@elpulpo.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ No se encontró el usuario admin1@elpulpo.com';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(v_nueva_password, gen_salt('bf'))
  WHERE id = v_user_id;

  DELETE FROM auth.sessions WHERE user_id = v_user_id;

  RAISE NOTICE '✅ Contraseña de admin1 actualizada exitosamente';
  RAISE NOTICE '🔒 Todas las sesiones activas han sido cerradas';
  RAISE NOTICE '⚠️  Guarda la nueva contraseña en un lugar seguro';
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5: Ver todos los usuarios y cuándo fue su último cambio de contraseña
--           (para auditoría, no modifica nada)
-- ══════════════════════════════════════════════════════════════════════════════
SELECT
  p.full_name,
  p.username,
  u.email,
  u.created_at   AS creado_el,
  u.updated_at   AS ultima_actualizacion,
  u.last_sign_in_at AS ultimo_login,
  CASE
    WHEN u.last_sign_in_at > (now() - INTERVAL '24 hours') THEN '🟢 Activo hoy'
    WHEN u.last_sign_in_at > (now() - INTERVAL '7 days')  THEN '🟡 Esta semana'
    WHEN u.last_sign_in_at IS NULL                         THEN '⚪ Nunca inició'
    ELSE '🔴 Inactivo'
  END AS estado_actividad
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
ORDER BY u.last_sign_in_at DESC NULLS LAST;
