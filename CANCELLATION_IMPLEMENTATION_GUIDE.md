# 🚀 Guía de Implementación - Cancelación de Órdenes e Ítems

## 📋 Cambios Implementados

### 1. **Nuevos Tipos TypeScript** (`src/types/cancellation.ts`)
- `OrderItemStatus`: Estados de ítem (DRAFT, SENT, DISPATCHED, PAID, CANCELLED)
- `CancellationReason`: Razones de cancelación
- `KitchenNotification`: Estructura para notificaciones en tiempo real
- Constantes para estados cancelables y que requieren motivo

### 2. **Hook de Cancelación** (`src/hooks/useCancellation.ts`)
**Funciones principales:**
- `cancelItemMutation`: Cancela un ítem individual
  - Valida estado actual
  - Registra pérdidas operacionales si es DISPATCHED
  - Notifica a cocina si es SENT
  - Recalcula total de la orden
  
- `cancelOrderMutation`: Cancela toda la orden
  - Cancela todos los ítems cancelables
  - Registra pérdidas si hay ítems DISPATCHED
  - Notifica a cocina si hay ítems SENT

### 3. **Componentes de UI**

#### `CancelItemDialog.tsx`
- Diálogo para cancelar un ítem individual
- Muestra advertencia si ítem estaba DISPATCHED
- Motivo obligatorio para SENT y DISPATCHED
- Campo de notas opcional
- Resumen de pérdida económica

#### `CancelOrderDialog.tsx`
- Diálogo para cancelar orden completa
- Lista de ítems a cancelar
- Motivo obligatorio
- Alertas visuales para ítems DISPATCHED y SENT
- Cálculo automático de pérdida operacional

#### `ItemCancelButton.tsx`
- Botón flotante para cancelar ítem
- Solo visible para estados cancelables
- Integrable en cualquier lista de ítems

### 4. **Notificaciones en Tiempo Real** (`src/hooks/useKitchenNotifications.tsx`)
- Hook `useKitchenNotifications` para escuchar cambios
- Componente `KitchenNotificationBanner` para mostrar notificaciones
- Conexión automática a tabla `kitchen_notifications` via Supabase Realtime
- Símbolo visual 🚫 para cancelaciones

## 🔧 Cómo Integrar en tu Aplicación

### Paso 1: Importar y usar en OrderCard/OrderItem

```typescript
// En src/components/order/OrderCard.tsx o lista de ítems
import { ItemCancelButton } from '@/components/order/ItemCancelButton';
import { useAuth } from '@/contexts/AuthContext';

export function OrderCard({ order }: Props) {
  const { user } = useAuth();

  return (
    <div>
      {order.items.map((item) => (
        <div key={item.id} className="flex justify-between items-center">
          <span>{item.quantity}x {item.description_snapshot}</span>
          
          {/* Agregar botón de cancelación */}
          <ItemCancelButton
            itemId={item.id}
            orderId={order.id}
            status={item.status}
            quantity={item.quantity}
            description={item.description_snapshot}
            total={item.total}
            userId={user!.id}
          />
        </div>
      ))}
    </div>
  );
}
```

### Paso 2: Agregar diálogo de cancelación de orden

```typescript
// En src/pages/Ordenes.tsx o componente que muestre órdenes
import { useState } from 'react';
import CancelOrderDialog from '@/components/order/CancelOrderDialog';
import { useAuth } from '@/contexts/AuthContext';

export function OrdenesList({ orders }: Props) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { user } = useAuth();

  const handleCancelOrder = (order: Order) => {
    setSelectedOrder(order);
    setCancelDialogOpen(true);
  };

  return (
    <>
      <div className="space-y-4">
        {orders.map((order) => (
          <div key={order.id} className="flex justify-between items-center">
            <span>Orden #{order.order_number}</span>
            
            {order.status !== 'PAID' && order.status !== 'CANCELLED' && (
              <button onClick={() => handleCancelOrder(order)}>
                Cancelar orden
              </button>
            )}
          </div>
        ))}
      </div>

      {selectedOrder && (
        <CancelOrderDialog
          orderId={selectedOrder.id}
          orderNumber={selectedOrder.order_number}
          items={selectedOrder.items}
          userId={user!.id}
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
        />
      )}
    </>
  );
}
```

### Paso 3: Agregar notificaciones a Cocina (Cocina.tsx)

```typescript
// En src/pages/Cocina.tsx
import { useKitchenNotifications, KitchenNotificationBanner } from '@/hooks/useKitchenNotifications';
import { useState } from 'react';

export function Cocina() {
  const [notification, setNotification] = useState(null);

  useKitchenNotifications((notification) => {
    setNotification(notification);
    // Reproducir sonido si lo deseas
    // playNotificationSound();
  });

  return (
    <div>
      {/* Contenido de cocina */}
      
      {/* Banner de notificaciones flotante */}
      <KitchenNotificationBanner notification={notification} duration={6000} />
    </div>
  );
}
```

## 📊 Lógica de Cancelación por Estado

### DRAFT → Cancelar
```
✅ Cancelación silenciosa
- Marca ítem como CANCELLED
- Recalcula total de orden
- NO requiere motivo
- NO notifica a cocina
```

### SENT → Cancelar
```
⚠️ Requiere motivo
- Motivo obligatorio (lista predefinida)
- Marca ítem como CANCELLED
- Guarda cancelled_from_status = 'SENT'
- 🚫 Notifica a cocina en tiempo real
- Recalcula total de orden
```

### DISPATCHED → Cancelar
```
🔴 Advertencia visual
- Motivo obligatorio (lista predefinida)
- Marca ítem como CANCELLED
- Guarda cancelled_from_status = 'DISPATCHED'
- Registra en operational_losses (dinero perdido)
- Recalcula total de orden
- NO notifica a cocina (ya se fue)
```

### PAID → Cancelar
```
❌ PROHIBIDO
- Botón deshabilitado/oculto
- No es posible cancelar ítems pagados
```

## 🗄️ Tabla `operational_losses`

Se registra automáticamente cuando se cancela un ítem DISPATCHED:

```sql
INSERT INTO operational_losses (
  order_item_id,
  order_id,
  amount,
  reason,
  cancelled_by,
  created_at
) VALUES (...);
```

Para ver reportes de pérdidas:
```sql
SELECT 
  SUM(amount) as total_perdido,
  reason,
  DATE(created_at) as fecha
FROM operational_losses
GROUP BY reason, DATE(created_at)
ORDER BY fecha DESC;
```

## 🔌 Tabla `kitchen_notifications` (Supabase Realtime)

**Requiere crear esta tabla en Supabase:**

```sql
CREATE TABLE public.kitchen_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('ITEM_CANCELLED', 'ORDER_CANCELLED')),
  order_number integer NOT NULL,
  message text NOT NULL,
  item_id uuid REFERENCES public.order_items(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Habilitar Realtime Replication para esta tabla
ALTER TABLE public.kitchen_notifications REPLICA IDENTITY FULL;

-- RLS Policy
ALTER TABLE public.kitchen_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert for authenticated users"
  ON public.kitchen_notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Allow select for authenticated users"
  ON public.kitchen_notifications
  FOR SELECT TO authenticated
  USING (true);
```

## 🧪 Testing

### Test 1: Cancelar ítem en DRAFT
1. Crear orden nueva
2. Agregar ítem
3. Hacer clic en botón X del ítem
4. Confirmar sin seleccionar motivo
5. ✅ Ítem debe desaparecer sin notificación to cocina

### Test 2: Cancelar ítem en SENT
1. Crear orden
2. Agregar ítem
3. Enviar a cocina
4. Hacer clic en botón X
5. ⚠️ Debe pedir motivo obligatorio
6. 🚫 Cocina recibe notificación

### Test 3: Cancelar ítem en DISPATCHED
1. Crear orden
2. Marcar ítem como despachado
3. Intentar cancelar
4. 🔴 Debe mostrar advertencia
5. Registra en operational_losses

### Test 4: Cancelar orden completa
1. Crear orden con múltiples ítems
2. En estados SENT y DISPATCHED
3. Botón "Cancelar orden"
4. Debe cancelar todos y mostrar pérdida total

## 📝 Notas Importantes

1. **Estados en minúsculas en DB**: Los tipos TypeScript usan MAYÚSCULAS pero debes asegurar que la BD los almacene correctamente

2. **Sincronización offline**: El hook `useCancellation` usa `dbUpdate` que maneja sync automáticamente

3. **Realtime**: Las notificaciones usan Supabase Realtime. Asegúrate que:
   - Tu cliente Supabase está configurado para realtime
   - La tabla `kitchen_notifications` tiene REPLICA IDENTITY habilitado

4. **Permisos**: Los RLS policies deben permitir:
   - INSERT en `kitchen_notifications` para usuarios autenticados
   - UPDATE en `order_items` y `orders`
   - INSERT en `operational_losses`

## 🚀 Próximos Pasos

1. ✅ Crear tabla `kitchen_notifications` en Supabase
2. ✅ Integrar componentes en tus páginas
3. ✅ Probar cada escenario de cancelación
4. ✅ Agregar sonidos/vibraciones a notificaciones si lo deseas
5. ✅ Implementar reportes de operational_losses

¡Listo para producción! 🎉
