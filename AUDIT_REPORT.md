# AUDIT REPORT — POS EL PULPO

## Resumen Ejecutivo
*Audit conducted on: 2026-04-22*
*System status: Under Audit*

[Summary of the audit will be placed here]

---

## Hallazgos por Módulo

### 1. Autenticación y gestión de sesión
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `AuthContext.tsx` | Arquitectura | 🟢 Menor | Uso de `as never` en llamadas RPC por falta de tipado estricto en el cliente Supabase. | Pendiente |
| `AuthContext.tsx` | Programación | 🟡 Moderado | `lastWriteAt` para throttle de actividad es local al efecto; se recomienda `useRef` para mayor consistencia en re-renders. | Corregido |
| `Login.tsx` | UX | 🟢 Menor | El input de identificador no hace trim antes de pasar al contexto (aunque el contexto lo hace). | Pendiente |
| `Login.tsx` | Diseño | 🟢 Menor | Falta de feedback visual específico si el navegador no soporta Passkeys (simplemente se oculta). | Pendiente |

### 2. Caja
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `useCaja.ts` | Arquitectura | 🟡 Moderado | Archivo excesivamente grande (2700+ líneas), dificulta mantenimiento y auditoría. | Pendiente |
| `Caja.tsx` | Programación | 🟢 Menor | Implementación manual de `escapeHtml`; se recomienda usar una librería o utilidad estándar. | Pendiente |
| `useBranchShiftGate.ts` | Arquitectura | 🟢 Menor | Múltiples peticiones secuenciales en el gate check aumentan latencia. | Pendiente |
| `PaymentDialog.tsx` | Finanzas/Lógica | 🟡 Moderado | Comparaciones de coma flotante con `0.001` son riesgosas; se recomienda comparar con epsilon o usar enteros (centavos). | Pendiente |
| `useCaja.ts` | Base de Datos | 🔴 Crítico | `ensureTableSnapshot` actualiza la orden sin validar permisos operativos vigentes (vía shift gate) o estado de bloqueo. | Pendiente |
| `Caja.tsx` | Logica/UX | 🟡 Moderado | `handleUploadSelectedPhoto` no maneja estados de reintento o degradación si el servidor de comprobantes falla post-inicio. | Pendiente |

### 3. Órdenes / Pedidos
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `Ordenes.tsx` | Arquitectura | 🟡 Moderado | Uso directo de `supabase` (locking, cleanup, lookup) ignorando `DatabaseService`. | Pendiente |
| `Ordenes.tsx` | Programación | 🟢 Menor | `window.print()` usado directamente; se recomienda abstraer para mejor soporte de tickets térmicos. | Pendiente |
| `EditarOrden.tsx` | Lógica/UX | 🟢 Menor | El filtrado de mesas editables es agresivo; podría ocultar mesas en estados transicionales. | Pendiente |
| `Ordenes.tsx` | Lógica | 🟡 Moderado | Cleanup de drafts vacíos al desmontar podría causar pérdida accidental si hay micro-desconexiones. | Pendiente |

### 4. Despacho
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `useDispatchOrders.ts` | Arquitectura | 🟡 Moderado | Uso directo de `supabase` ignorando `DatabaseService`. | Pendiente |
| `useDispatchOrders.ts` | Operacionales | 🟡 Moderado | El agrupamiento por `sent_to_kitchen_at` es sensible a micro-diferencias de tiempo, lo que puede fragmentar comandas. | Pendiente |
| `useDispatchOrders.ts` | Programación | 🟢 Menor | `refetchInterval` de 5s constante; podría optimizarse con `realtime` de Supabase para reducir carga. | Pendiente |
| `useDispatchAccess.ts` | Seguridad | 🟢 Menor | Lógica de permisos muy ramificada; difícil de testear exhaustivamente. | Pendiente |

### 5. Mesas
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `useTablesWithStatus.ts` | Arquitectura/Performance | 🔴 Crítico | Suscripciones `realtime` sin filtro de `branch_id` en tablas compartidas (payments, items), causando invalidaciones excesivas globales. | Pendiente |
| `useTablesWithStatus.ts` | Lógica/DB | 🟡 Moderado | Identificación de pagos anulados vía `ilike` en campo de notas; propenso a errores y frágil. | Pendiente |
| `useTablesWithStatus.ts` | Rendimiento | 🟡 Moderado | `fetchOrderDetail` en serie para cada orden anulada dentro del fetch principal; escala mal con el volumen del turno. | Pendiente |
| `Mesas.tsx` | Arquitectura | 🟡 Moderado | Creación de órdenes (Tray/Special) usa `supabase` directo en lugar de `DatabaseService`. | Pendiente |

### 6. Catálogo / Menú
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `useMenuTree.ts` | Arquitectura | 🟡 Moderado | Uso directo de `supabase` ignorando `DatabaseService`. | Pendiente |
| `useMenuTree.ts` | Rendimiento | 🟢 Menor | `resolveAncestorIds` y `resolveManualPrice` recalculan herencias en cada cambio de `nodes`, aunque usan un cache interno temporal. | Pendiente |

### 7. Administración de usuarios y roles
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

### 8. Reportes y Dashboard
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `useReportesData.ts` | Seguridad | 🔴 Crítico | Consulta de órdenes remota no filtra por `branch_id`; fuga de datos entre sucursales. | Pendiente |
| `useReportesData.ts` | Rendimiento | 🔴 Crítico | N+1 Query: Ejecuta una consulta a Supabase por cada orden para obtener el total, causando cientos de peticiones innecesarias. | Pendiente |
| `useReportesData.ts` | Arquitectura | 🟡 Moderado | Mezcla lógica de sincronización (IndexedDB) con reportes; debería estar en servicios separados. | Pendiente |

### 9. Configuración y Sistema
| Archivo | Dimensión | Severidad | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `types.ts` | Arquitectura | 🔴 Crítico | Desincronización masiva entre la base de datos real y las definiciones de TypeScript (vía Supabase). Columnas críticas como `tray_item_type`, `is_tray_order` y `table_name_snapshot` faltan en los tipos pero se usan en el código. | Pendiente |
| `DispatchConfig.tsx` | Lógica | 🟢 Menor | Lógica de configuración de despacho distribuido compleja que depende de estados locales no persistidos durante la edición. | Pendiente |

---

## Problemas Pendientes / Decisión del Equipo
[List of issues requiring external decision]

---

## Recomendaciones a Futuro
[Strategic recommendations]
