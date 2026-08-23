-- =============================================================================
-- Etapa 4 — Medición de carga (SOLO LECTURA)
-- Sistema El Pulpo — post Etapas 1–3 (fan-out Caja, TTL Despacho, gap dispatch)
--
-- Cómo usar:
-- 1. Desplegar el frontend con Etapas 1–3.
-- 2. Ejecutar la SECCIÓN A (snapshot "antes del pico" o baseline).
-- 3. Esperar 20–30 min de operación normal (Mesas + Despacho/Servir + Recaudar).
-- 4. Ejecutar de nuevo SECCIÓN A y SECCIÓN B; comparar deltas.
-- 5. En Dashboard Supabase: Reports → Disk IO / CPU / Database → Slow Queries.
--
-- NO escribe datos. NO crea índices. NO altera funciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECCIÓN A — Top statements (pg_stat_statements)
-- Requiere extensión pg_stat_statements (suele estar activa en Supabase).
-- -----------------------------------------------------------------------------

-- A1. RPCs operativas pesadas (las 3 del diagnóstico)
SELECT
  ROUND(total_exec_time::numeric, 1) AS total_ms,
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND((100 * total_exec_time / NULLIF(SUM(total_exec_time) OVER (), 0))::numeric, 2) AS pct_total_time,
  LEFT(query, 180) AS query_preview
FROM pg_stat_statements
WHERE query ILIKE '%get_dispatch_servir_queue_bundle%'
   OR query ILIKE '%get_tables_overview_bundle%'
   OR query ILIKE '%get_caja_payable_queue_bundle%'
   OR query ILIKE '%get_my_branch_shift_gate%'
ORDER BY total_exec_time DESC;

-- A2. Top 25 por tiempo total (cualquier query)
SELECT
  ROUND(total_exec_time::numeric, 1) AS total_ms,
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND((shared_blks_read + shared_blks_hit)::numeric, 0) AS blks_touched,
  ROUND(shared_blks_read::numeric, 0) AS blks_read,
  LEFT(query, 160) AS query_preview
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;

-- A3. Top por llamadas (frecuencia — útil para fan-out Realtime)
SELECT
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND(total_exec_time::numeric, 1) AS total_ms,
  LEFT(query, 160) AS query_preview
FROM pg_stat_statements
WHERE query ILIKE '%get_dispatch_servir_queue_bundle%'
   OR query ILIKE '%get_tables_overview_bundle%'
   OR query ILIKE '%get_caja_payable_queue_bundle%'
   OR query ILIKE '%order_items%'
   OR query ILIKE '%cash_shift%'
ORDER BY calls DESC
LIMIT 30;

-- -----------------------------------------------------------------------------
-- SECCIÓN B — Actividad actual / locks (durante el pico)
-- -----------------------------------------------------------------------------

-- B1. Queries en ejecución ahora
SELECT
  pid,
  now() - query_start AS running_for,
  wait_event_type,
  wait_event,
  state,
  LEFT(query, 200) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
  AND pid <> pg_backend_pid()
ORDER BY query_start;

-- B2. Locks bloqueantes (si hay "UPDATE orders" pegados)
SELECT
  blocked.pid AS blocked_pid,
  LEFT(blocked.query, 120) AS blocked_query,
  blocking.pid AS blocking_pid,
  LEFT(blocking.query, 120) AS blocking_query,
  now() - blocked.query_start AS blocked_for
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks kl
  ON kl.locktype = bl.locktype
 AND kl.database IS NOT DISTINCT FROM bl.database
 AND kl.relation IS NOT DISTINCT FROM bl.relation
 AND kl.page IS NOT DISTINCT FROM bl.page
 AND kl.tuple IS NOT DISTINCT FROM bl.tuple
 AND kl.virtualxid IS NOT DISTINCT FROM bl.virtualxid
 AND kl.transactionid IS NOT DISTINCT FROM bl.transactionid
 AND kl.classid IS NOT DISTINCT FROM bl.classid
 AND kl.objid IS NOT DISTINCT FROM bl.objid
 AND kl.objsubid IS NOT DISTINCT FROM bl.objsubid
 AND kl.granted
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
WHERE blocked.pid <> blocking.pid;

-- -----------------------------------------------------------------------------
-- SECCIÓN C — Snapshot opcional de llamadas (para delta manual)
-- Anota calls de A1 ANTES y DESPUÉS del pico; el delta ≈ ejecuciones en la ventana.
--
-- Ejemplo de hoja de cálculo:
--   RPC                              | calls_t0 | calls_t1 | delta | mean_ms
--   get_caja_payable_queue_bundle    |          |          |       |
--   get_dispatch_servir_queue_bundle |          |          |       |
--   get_tables_overview_bundle       |          |          |       |
--
-- Criterio esperado post Etapas 1–3 (misma flota / mismo ritmo de ventas):
--   - get_caja_payable_queue_bundle: delta de calls BAJA (fan-out order_items cortado)
--   - get_dispatch_servir_queue_bundle: calls similares o algo menos (TTL 25s)
--   - get_tables_overview_bundle: sin cambio grande en Etapas 1–3 (Mesas aún no tocadas)
-- -----------------------------------------------------------------------------

-- C1. Conteos compactos solo de las 3 RPC (pegar resultado en la hoja)
SELECT
  CASE
    WHEN query ILIKE '%get_caja_payable_queue_bundle%' THEN 'caja_payable'
    WHEN query ILIKE '%get_dispatch_servir_queue_bundle%' THEN 'dispatch_servir'
    WHEN query ILIKE '%get_tables_overview_bundle%' THEN 'tables_overview'
    WHEN query ILIKE '%get_my_branch_shift_gate_v2%' THEN 'shift_gate_v2'
    WHEN query ILIKE '%get_my_branch_shift_gate%' THEN 'shift_gate_v1'
    ELSE 'other'
  END AS rpc_label,
  SUM(calls) AS calls,
  ROUND(SUM(total_exec_time)::numeric, 1) AS total_ms,
  ROUND((SUM(total_exec_time) / NULLIF(SUM(calls), 0))::numeric, 2) AS mean_ms
FROM pg_stat_statements
WHERE query ILIKE '%get_dispatch_servir_queue_bundle%'
   OR query ILIKE '%get_tables_overview_bundle%'
   OR query ILIKE '%get_caja_payable_queue_bundle%'
   OR query ILIKE '%get_my_branch_shift_gate%'
GROUP BY 1
ORDER BY calls DESC;
