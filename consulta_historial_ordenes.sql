-- =====================================================
-- CONSULTAS PARA VER EL HISTORIAL DE ÓRDENES
-- Ejecutar cada consulta por separado en Supabase SQL Editor
-- =====================================================

-- =====================================================
-- CONSULTA 1: RESUMEN DE ÓRDENES (RECOMENDADA PARA EMPEZAR)
-- =====================================================
SELECT
    o.order_number as numero_orden,
    o.order_code as codigo_orden,
    o.status as estado,
    o.order_type as tipo_orden,
    COALESCE(rt.name, 'SIN MESA') as mesa,
    COALESCE(p.full_name, 'DESCONOCIDO') as creado_por,
    o.created_at as fecha_creacion,
    o.updated_at as fecha_actualizacion,
    COUNT(oi.id) as cantidad_items,
    COALESCE(SUM(oi.total), 0) as total_orden
FROM orders o
LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
LEFT JOIN profiles p ON o.created_by = p.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id, o.order_number, o.order_code, o.status, o.order_type, rt.name, p.full_name, o.created_at, o.updated_at
ORDER BY o.created_at DESC, o.order_number DESC;

ORDER BY o.created_at DESC, o.order_number DESC;

-- =====================================================
-- CONSULTA 2: DETALLES DE ÍTEMS POR ORDEN
-- =====================================================
SELECT
    o.order_number,
    o.order_code,
    oi.description_snapshot as producto,
    oi.quantity as cantidad,
    oi.unit_price as precio_unitario,
    oi.total as total_item,
    oi.dispatched_at as despachado_en,
    oi.paid_at as pagado_en,
    oi.created_at as agregado_en
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
ORDER BY o.order_number DESC, oi.created_at ASC;

-- =====================================================
-- CONSULTA 3: MODIFICADORES POR ÍTEM
-- =====================================================
SELECT
    o.order_number,
    oi.description_snapshot as producto,
    m.description as modificador
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN order_item_modifiers oim ON oi.id = oim.order_item_id
JOIN modifiers m ON oim.modifier_id = m.id
ORDER BY o.order_number DESC, oi.created_at ASC, m.description;

-- =====================================================
-- CONSULTA 4: PAGOS REALIZADOS
-- =====================================================
SELECT
    o.order_number,
    o.order_code,
    pay.amount as monto_pagado,
    COALESCE(pm.name, 'MÉTODO DESCONOCIDO') as metodo_pago,
    COALESCE(p.full_name, 'DESCONOCIDO') as pagado_por,
    pay.notes as notas,
    pay.created_at as fecha_pago
FROM orders o
JOIN payments pay ON o.id = pay.order_id
LEFT JOIN payment_methods pm ON pay.payment_method_id = pm.id
LEFT JOIN profiles p ON pay.created_by = p.id
ORDER BY pay.created_at DESC;

-- =====================================================
-- CONSULTA 5: RESUMEN POR ESTADO
-- =====================================================
SELECT
    status as estado_orden,
    COUNT(*) as cantidad_ordenes,
    COALESCE(SUM(totales.total), 0) as total_ventas
FROM (
    SELECT o.id, o.status, COALESCE(SUM(oi.total), 0) as total
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    GROUP BY o.id, o.status
) totales
GROUP BY totales.status
ORDER BY cantidad_ordenes DESC;

-- =====================================================
-- CONSULTA 6: ÓRDENES DE HOY
-- =====================================================
SELECT
    o.order_number,
    o.order_code,
    o.status,
    COALESCE(rt.name, 'SIN MESA') as mesa,
    COALESCE(p.full_name, 'DESCONOCIDO') as mesero,
    COUNT(oi.id) as cantidad_items,
    COALESCE(SUM(oi.total), 0) as total_orden,
    o.created_at as hora_creacion
FROM orders o
LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
LEFT JOIN profiles p ON o.created_by = p.id
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE DATE(o.created_at) = CURRENT_DATE
GROUP BY o.id, o.order_number, o.order_code, o.status, rt.name, p.full_name, o.created_at
ORDER BY o.created_at DESC;

-- =====================================================
-- CONSULTA 7: ÓRDENES CANCELADAS
-- =====================================================
SELECT
    o.order_number,
    o.order_code,
    COALESCE(rt.name, 'SIN MESA') as mesa,
    COALESCE(p.full_name, 'DESCONOCIDO') as creado_por,
    o.updated_at as fecha_cancelacion,
    COUNT(oi.id) as items_cancelados,
    COALESCE(SUM(oi.total), 0) as total_perdido
FROM orders o
LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
LEFT JOIN profiles p ON o.created_by = p.id
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'CANCELLED'
GROUP BY o.id, o.order_number, o.order_code, rt.name, p.full_name, o.updated_at
ORDER BY o.updated_at DESC;

-- =====================================================
-- CONSULTA 8: DETALLE COMPLETO DE UNA ORDEN ESPECÍFICA
-- =====================================================
-- Reemplaza '12345' con el número de orden que quieras ver
SELECT
    o.order_number,
    o.order_code,
    o.status,
    o.order_type,
    COALESCE(rt.name, 'SIN MESA') as mesa,
    COALESCE(p.full_name, 'DESCONOCIDO') as creado_por,
    o.created_at,
    o.updated_at,
    -- Ítems
    oi.description_snapshot as producto,
    oi.quantity,
    oi.unit_price,
    oi.total as total_item,
    -- Pagos
    pay.amount as monto_pago,
    COALESCE(pm.name, 'MÉTODO DESCONOCIDO') as metodo_pago
FROM orders o
LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
LEFT JOIN profiles p ON o.created_by = p.id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN payments pay ON o.id = pay.order_id
LEFT JOIN payment_methods pm ON pay.payment_method_id = pm.id
WHERE o.order_number = 12345
ORDER BY oi.created_at ASC;

-- =====================================================
-- NOTAS DE USO:
-- =====================================================
-- 1. Ejecuta CADA consulta por separado (NO todas a la vez)
-- 2. Para la Consulta 8, cambia '12345' por el número de orden que quieras
-- 3. Usa LIMIT 10 al final si quieres limitar resultados: ... ORDER BY ... LIMIT 10;
-- 4. Si ves errores de límite, selecciona "No limit" en Supabase</content>
<parameter name="filePath">c:\sistema-el-pulpo\consulta_historial_ordenes.sql