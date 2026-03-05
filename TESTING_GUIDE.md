# 🧪 Guía de Testing - Sistema de Cancelaciones

## 📋 Tabla de Contenidos
1. Setup Previo
2. Escenarios de Testing
3. Validaciones por Estado de Ítem
4. Testing de Notificaciones
5. Verificación de Base de Datos
6. Checklist Final

---

## 🔧 Setup Previo

### Requisitos:
- ✅ Migración de BD ejecutada (`20260305140000_create_kitchen_notifications.sql`)
- ✅ Aplicación compilada sin errores
- ✅ Usuario autenticado en el sistema
- ✅ Branch/Sucursal activa seleccionada

### Verificar Conexión con Supabase:

```sql
-- En Supabase SQL Editor
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name IN ('kitchen_notifications', 'operational_losses');
```

Debe retornar ambas tablas.

---

## 🎯 Escenarios de Testing

### Escenario 1: Cancelar Ítem en Estado DRAFT ✅ (Silencioso)

**Objetivo**: Verificar que ítems en DRAFT se cancelen sin notificación

**Pasos**:
1. Ir a **Órdenes**
2. Crear nueva orden o seleccionar una en DRAFT
3. Agregar un producto (quedará en DRAFT)
4. Hacer clic en el botón **X rojo** del ítem
5. **NO debe aparecer** diálogo de confirmación (cancelación silenciosa)
6. El ítem debe desaparecer inmediatamente

**Validaciones**:
- ✅ Orden aún visible en lista
- ✅ Ítem desaparece de la orden
- ✅ Total de orden se recalcula
- **NO** debe haber notificación en Cocina

**Verificar en BD**:
```sql
-- Debería tener status='CANCELLED'
SELECT id, status, cancelled_from_status FROM public.order_items 
WHERE id = 'item-uuid-aqui' LIMIT 1;

-- NO debe haber registro en kitchen_notifications
SELECT * FROM public.kitchen_notifications 
WHERE order_item_id = 'item-uuid-aqui';
```

---

### Escenario 2: Cancelar Ítem en Estado SENT ⚠️ (Requiere Motivo)

**Objetivo**: Verificar que ítems SENT requieren motivo y notifican a cocina

**Pasos**:
1. Ir a **Órdenes**
2. Crear nueva orden y agregar producto
3. Hacer clic en **Enviar a Cocina** 
4. Ítem debe estar en estado SENT
5. Hacer clic en botón **X rojo**
6. **DEBE aparecer** diálogo con:
   - ⚠️ Advertencia
   - 📋 Campo de **Motivo obligatorio**
   - 📝 Campo de notas opcional
7. **SIN seleccionar motivo**, clic en **Cancelar** → Debe mostrar error
8. Seleccionar motivo (ej: "Cliente cambió de opinión")
9. Clic en **Cancelar Ítem** → Debe confirmarse

**Validaciones**:
- ✅ Diálogo requiere motivo
- ✅ Botón disabled sin motivo
- ✅ Total se recalcula
- ✅ Notificación sent a Cocina

**Verificar en BD**:
```sql
-- Status debe ser CANCELLED
SELECT id, status, cancelled_from_status, cancellation_reason 
FROM public.order_items 
WHERE id = 'item-uuid-aqui';

-- DEBE haber notificación en kitchen_notifications
SELECT type, message, created_at 
FROM public.kitchen_notifications 
WHERE order_item_id = 'item-uuid-aqui'
ORDER BY created_at DESC LIMIT 1;
```

---

### Escenario 3: Cancelar Ítem en Estado DISPATCHED 🔴 (Operativa + Advertencia Visual)

**Objetivo**: Verificar registro de pérdidas operacionales

**Pasos**:
1. Crear y enviar orden a cocina
2. Marcar ítem como "Despachado" (si existe opción en Cocina)
3. Hacer clic en **X rojo** del ítem
4. **DEBE aparecer**:
   - 🔴 Advertencia roja: "Ítem ya despachado"
   - 💰 Cálculo de pérdida: `$XX.XX`
   - 📋 Motivo obligatorio
5. Seleccionar motivo y confirmar cancelación

**Validaciones**:
- ✅ Muestra advertencia visual
- ✅ Muestra monto perdido
- ✅ Requiere motivo
- ✅ Registra en operational_losses

**Verificar en BD**:
```sql
-- Ver registro de pérdida operacional
SELECT order_id, order_item_id, amount, reason, created_at
FROM public.operational_losses
WHERE order_item_id = 'item-uuid-aqui'
ORDER BY created_at DESC LIMIT 1;

-- Debe mostrar cantidad y monto correcto
```

**Reporte de Pérdidas**:
```sql
-- Resumen diario de pérdidas
SELECT 
  DATE(created_at) as fecha,
  COUNT(*) as cantidad_items,
  SUM(amount) as total_perdido,
  reason
FROM public.operational_losses
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY DATE(created_at), reason
ORDER BY total_perdido DESC;
```

---

### Escenario 4: Cancelar Ítem en Estado PAID ❌ (Prohibido)

**Objetivo**: Verificar que ítems pagados NO se pueden cancelar

**Pasos**:
1. Crear orden y completar pago
2. En la orden pagada, intentar hacer clic en **X** del ítem
3. **NO debe aparecer** botón X (debe estar oculto)

**Validaciones**:
- ✅ Botón X no visible para ítems PAID
- ✅ No hay forma de cancelar pagado

---

### Escenario 5: Cancelar Orden Completa 🗑️

**Objetivo**: Verificar cancelación de múltiples ítems a la vez

**Pasos**:
1. Crear orden con **2-3 productos** en estados mixtos:
   - 1 en DRAFT
   - 1 en SENT
   - 1 en DISPATCHED (si es posible)
2. Hacer clic en botón **"Cancelar Orden"** (pie de la orden)
3. Diálogo mostrará:
   - 📋 Lista de ítems a cancelar
   - 🔴 Advertencias por ítem DISPATCHED
   - 💰 Total de pérdidas operacionales
   - 📋 Motivo obligatorio
4. Seleccionar motivo
5. Clic en **"Cancelar Orden Completa"**

**Validaciones**:
- ✅ Cancela todos los ítems no pagados
- ✅ Calcula pérdidas totales
- ✅ Requiere motivo
- ✅ Notifica a cocina si hay SENT

**Verificar en BD**:
```sql
-- Todos los ítems deben ser CANCELLED
SELECT COUNT(*) as cancelados, status
FROM public.order_items
WHERE order_id = 'order-uuid-aqui'
GROUP BY status;

-- Orden debe estar CANCELLED
SELECT id, status, cancelled_from_status, cancellation_reason
FROM public.orders
WHERE id = 'order-uuid-aqui';

-- Múltiples pérdidas si había DISPATCHED
SELECT COUNT(*) as total_perdidas, SUM(amount) as monto_total
FROM public.operational_losses
WHERE order_id = 'order-uuid-aqui';
```

---

## 📱 Testing de Notificaciones en Cocina

### Requisito: Integrar KitchenNotificationBanner en Cocina.tsx

Mientras no esté integrado, puedes verificar notificaciones así:

```sql
-- Ver últimas notificaciones en tiempo real
SELECT type, order_number, message, created_at
FROM public.kitchen_notifications
ORDER BY created_at DESC
LIMIT 10;
```

**Cuando esté integrada la UI:**
1. Abrir **Módulo Cocina** en otra ventana
2. Cancelar ítems SENT desde otra ventana
3. Verificar que aparece notificación en Cocina con:
   - 🚫 Icono de cancelación
   - Orden #XXX
   - Razón de cancelación
   - Auto-desaparece en 5-6 segundos

---

## 🔍 Verificación Completa de Base de Datos

### 1. Estructura de Tablas

```sql
-- Ver estructura de kitchen_notifications
\d public.kitchen_notifications;

-- Ver estructura de operational_losses
\d public.operational_losses;

-- Verificar que order_items tiene nuevas columnas
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'order_items' AND column_name IN (
  'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'cancelled_from_status'
);
```

### 2. Datos de Prueba Completos

```sql
-- Dashboard: Resumen de cancelaciones del día
SELECT 
  'Ítems en DRAFT Cancelados' as tipo,
  COUNT(*) as cantidad,
  SUM(COALESCE((SELECT 1), 0)) as items
FROM public.order_items
WHERE DATE(cancelled_at) = CURRENT_DATE 
  AND cancelled_from_status = 'DRAFT'
UNION ALL
SELECT 
  'Ítems SENT Cancelados',
  COUNT(*),
  0
FROM public.order_items
WHERE DATE(cancelled_at) = CURRENT_DATE 
  AND cancelled_from_status = 'SENT'
UNION ALL
SELECT 
  'Ítems DISPATCHED Cancelados',
  COUNT(),
  0
FROM public.order_items
WHERE DATE(cancelled_at) = CURRENT_DATE 
  AND cancelled_from_status = 'DISPATCHED'
UNION ALL
SELECT
  'Órdenes Completas Canceladas',
  COUNT(*),
  0
FROM public.orders
WHERE DATE(cancelled_at) = CURRENT_DATE
  AND status = 'CANCELLED';
```

---

## ✅ Checklist de Validación Final

### Por Tipo de Estado:

- [ ] **DRAFT**: Cancelación silenciosa sin diálogo
- [ ] **DRAFT**: No genera notificación a cocina
- [ ] **DRAFT**: Total se recalcula correctamente

- [ ] **SENT**: Requiere motivo en diálogo
- [ ] **SENT**: Muestra advertencia
- [ ] **SENT**: Notifica a cocina
- [ ] **SENT**: Se registra razón de cancelación

- [ ] **DISPATCHED**: Muestra advertencia roja
- [ ] **DISPATCHED**: Calcula pérdida economica
- [ ] **DISPATCHED**: Registra en operational_losses
- [ ] **DISPATCHED**: Requiere motivo

- [ ] **PAID**: Botón X no visible
- [ ] **PAID**: No hay forma de cancelar

### Cancelación de Orden Completa:

- [ ] Muestra todos los ítems a cancelar
- [ ] Lista separada para DISPATCHED y SENT
- [ ] Calcula total de pérdidas
- [ ] Cancela todos los ítems
- [ ] Actualiza estado de orden a CANCELLED
- [ ] Notifica a cocina

### Integridad de Datos:

- [ ] `kitchen_notifications` tabla existe
- [ ] `operational_losses` tabla existe
- [ ] Campos de cancelación en `order_items` existen
- [ ] Campo `status` en `order_items` correcto
- [ ] RLS Policies configuradas correctamente

### UI/UX:

- [ ] Botones visibles solo cuando corresponde
- [ ] Diálogos muestran información completa
- [ ] Advertencias visuales claras
- [ ] Cálculos mostrados correctamente
- [ ] Mensajes de éxito/error apropiados

---

## 🚀 Testing Manual Paso a Paso

### Test Suite 1: Cancelación Individual (15 min)

```
1. Crear Orden → Agregar Producto (DRAFT)
   ✓ Cancelar → Debe desaparecer sin diálogo
   
2. Crear Orden → Agregar Producto → Enviar a Cocina (SENT)
   ✓ Cancelar → Diálogo con motivo requerido
   ✓ Verificar notificación en BD
   
3. (Si disponible) Marcar DISPATCHED
   ✓ Cancelar → Advertencia + Pérdida registrada
   
4. Crear Orden Pagada
   ✓ Botón X no visible
```

### Test Suite 2: Cancelación de Orden (10 min)

```
1. Crear Orden con 3 ítems en estados mixtos
   ✓ Botón "Cancelar Orden"
   ✓ Diálogo muestra todos
   ✓ Requiere motivo
   ✓ Calcula pérdidas totales
   
2. Confirmar cancelación
   ✓ Todos los ítems CANCELLED
   ✓ Orden está CANCELLED
   ✓ Notificación en BD
```

### Test Suite 3: Integridad de Datos (5 min)

```
Ejecutar queries de validación:
   ✓ Todos los ítems cancelados tienen metadatos
   ✓ Pérdidas solo para DISPATCHED
   ✓ Notificaciones solo para SENT/ORDER_CANCELLED
   ✓ Totales se recalcularon
```

---

## 📊 Reportes de Validación

### Reporte de Cancelaciones Diarias:

```sql
SELECT 
  DATE(cancelled_at) as fecha,
  cancelled_from_status,
  cancellation_reason,
  COUNT(*) as cantidad,
  SUM(COALESCE(total, 0)) as valor_total
FROM public.order_items
WHERE status = 'CANCELLED'
  AND DATE(cancelled_at) = CURRENT_DATE
GROUP BY DATE(cancelled_at), cancelled_from_status, cancellation_reason
ORDER BY cancelled_from_status, cancellation_reason;
```

### Reporte de Pérdidas Operacionales:

```sql
SELECT 
  DATE(created_at) as fecha,
  reason,
  COUNT(*) as items_perdidos,
  SUM(amount) as monto_total
FROM public.operational_losses
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY DATE(created_at), reason
HAVING SUM(amount) > 0
ORDER BY monto_total DESC;
```

---

## 🆘 Solución de Problemas

| Problema | Causa Posible | Solución |
|----------|---------------|----------|
| Botón X no aparece en ítems SENT | Estado mal mapeado | Verificar que status = 'SENT' (no 'SENT_TO_KITCHEN') |
| Diálogo no abre | Componente no importado | Verificar imports en página |
| Notificación no llega | Realtime no habilitado | Verificar `REPLICA IDENTITY FULL` |
| Pérdida no registrada | Branch ID no disponible | Verificar BranchContext |
| Build falla | TypeScript errors | Revisar imports en useCancellation |

---

## ✨ Próximos Pasos Después de Testing

1. ✅ Completar testing de todos los escenarios
2. ✅ Integrar KitchenNotificationBanner en Cocina.tsx
3. ✅ Crear dashboard visual de operational_losses
4. ✅ Implementar filtros por razón/fecha en reportes
5. ✅ Agregar auditoría de quién canceló qué

---

¡Testing completo asegura un sistema robusto! 🚀
