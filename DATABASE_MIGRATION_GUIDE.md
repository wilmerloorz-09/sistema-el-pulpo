# 🗄️ Migración de Base de Datos - kitchen_notifications

## 📝 Descripción

He creado una migración SQL que crea las tablas necesarias para:
- 🔔 **kitchen_notifications**: Notificaciones en tiempo real para la cocina
- 💰 **operational_losses**: Tracking de pérdidas operacionales
- Columnas adicionales en **orders** y **order_items** para cancelaciones

**Archivo**: `supabase/migrations/20260305140000_create_kitchen_notifications.sql`

## 🚀 Cómo Aplicar la Migración

### Opción 1: Usar Supabase CLI (Recomendado)

```bash
# Asegúrate de estar en el directorio del proyecto
cd c:\sistema-el-pulpo

# Aplica la migración
supabase migration up
```

### Opción 2: Usar Supabase Dashboard

1. Ve a: https://app.supabase.com
2. Selecciona tu proyecto
3. Ve a: **SQL Editor** → **New Query**
4. Copia el contenido de `supabase/migrations/20260305140000_create_kitchen_notifications.sql`
5. Pega el SQL y haz clic en **Run**

### Opción 3: Usar Supabase Migrations (Sync)

```bash
# Si usas supabase CLI sincronizado
supabase db push
```

## ✅ Verificar que la Migración se Aplicó Correctamente

En Supabase Dashboard:

```sql
-- Verificar que la tabla kitchen_notifications existe
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'kitchen_notifications';

-- Verificar que la tabla operational_losses existe
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'operational_losses';

-- Ver la estructura de kitchen_notifications
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'kitchen_notifications';
```

## 📊 Estructura de las Tablas

### kitchen_notifications
```sql
id (uuid, PRIMARY KEY)
type (text) - ITEM_CANCELLED | ORDER_CANCELLED
order_id (uuid, REFERENCES orders)
order_number (integer)
order_item_id (uuid, REFERENCES order_items) - NULL para cancelaciones de orden completa
message (text)
branch_id (uuid, REFERENCES branches)
created_at (timestamptz) - DEFAULT now()
```

### operational_losses
```sql
id (uuid, PRIMARY KEY)
order_id (uuid, REFERENCES orders)
order_item_id (uuid, REFERENCES order_items)
amount (numeric(10,2)) - Monto perdido
reason (text) - Razón de la cancelación
cancelled_by (uuid, REFERENCES profiles)
branch_id (uuid, REFERENCES branches)
created_at (timestamptz) - DEFAULT now()
```

## 🔒 Seguridad (RLS Policies)

La migración incluye:
- ✅ Políticas RLS (Row Level Security) habilitadas
- ✅ Permiso de lectura para usuarios autenticados
- ✅ Permiso de escritura para usuarios autenticados
- ✅ Realtime habilitado en kitchen_notifications (REPLICA IDENTITY FULL)

## 🔄 Realtime en Supabase

La tabla `kitchen_notifications` está configurada para Realtime:

```typescript
// Es automático una vez que apliques la migración
// El hook useKitchenNotifications escuchará cambios en tiempo real:

const { notification } = useKitchenNotifications((newNotification) => {
  console.log('New notification:', newNotification);
});
```

## 🧪 Testing la Migración

Una vez aplicada, puedes hacer pruebas:

```sql
-- Insertar una notificación de prueba
INSERT INTO public.kitchen_notifications (
  type,
  order_id,
  order_number,
  message,
  branch_id
) VALUES (
  'ITEM_CANCELLED',
  'your-order-uuid',
  1001,
  'Ítem cancelado',
  'your-branch-uuid'
);

-- Ver todas las notificaciones
SELECT * FROM public.kitchen_notifications ORDER BY created_at DESC;

-- Ver pérdidas operacionales
SELECT 
  SUM(amount) as total_perdido,
  DATE(created_at) as fecha,
  reason
FROM public.operational_losses
GROUP BY DATE(created_at), reason
ORDER BY fecha DESC;
```

## ⚠️ Notas Importantes

1. **Idempotencia**: La migración usa `IF NOT EXISTS` para evitar errores si ya existen las tablas
2. **Backup**: Supabase automáticamente hace backup antes de migración
3. **Realtime**: Asegúrate que en `supabase/config.toml` tienes realtime habilitado para tu proyecto
4. **Columnas opcionales**: Algunos campos como `cancelled_by` usan `ON DELETE SET NULL` para no romper historiales

## 📱 Próximas Pasos

Una vez la migración esté aplicada:

1. ✅ El hook `useKitchenNotifications` funcionará automáticamente
2. ✅ Las cancelaciones registrarán notificaciones en tiempo real
3. ✅ Se crearán registros en `operational_losses` para auditoría
4. ✅ El dashboard podrá mostrar pérdidas operacionales por fecha/razón

## 🆘 Solución de Problemas

### Error: "Table already exists"
→ Esto está manejado por la migración con `IF NOT EXISTS`

### Error: "Permission denied"
→ Asegúrate que tienes rol de admin en Supabase

### Realtime no funciona
→ Verifica que tienes habilitado Realtime en tu proyecto de Supabase

### Las notificaciones no se muestran
→ Verifica que `REPLICA IDENTITY FULL` está set en la tabla:
```sql
SELECT * FROM information_schema.tables 
WHERE table_name = 'kitchen_notifications';
```

¡Listo! Una vez aplicada la migración, el sistema está listo para funcionar. 🚀
