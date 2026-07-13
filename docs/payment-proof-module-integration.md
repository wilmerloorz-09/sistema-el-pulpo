# Modulo De Comprobantes De Transferencia

## Estructura De Archivos

```text
proof_capture_backend/
  alembic.ini
  alembic/
    env.py
    versions/
      20260404_000001_payment_proofs.py
  app/
    api/
      deps.py
      routes/
        payment_proofs.py
    core/
      config.py
    db/
      base.py
      session.py
    models/
      base.py
      payment_proof.py
    schemas/
      common.py
      payment_proof.py
    services/
      audit_service.py
      auth_service.py
      image_validation_service.py
      payment_capture_service.py
      payment_proof_service.py
      permission_service.py
      storage_service.py
  tests/
    conftest.py
    test_image_validation_service.py
    test_payment_capture_service.py

proof_capture_frontend_vue/
  package.json
  src/
    components/
      CashSessionCaptureUserSelector.vue
      MobileCaptureProofView.vue
      TransferProofPanel.vue
    services/
      paymentProofApi.ts
    stores/
      paymentProof.ts
    types/
      payment-proof.ts
```

## Decisiones De Integracion

- Se reutiliza `public.cash_shifts` como `cash_sessions`.
- Se reutiliza `public.payments`; las migraciones le agregan `status`, `currency`, `updated_at`, y desde 2026-07-12 tambien `banco_id` (FK `bancos`) y `numero_transferencia` para cobros por transferencia en caja POS.
- Tabla `public.bancos`: catalogo global administrado en Admin > Bancos (solo admin global).
- Unicidad operativa: la combinacion `banco_id` + `numero_transferencia` no puede repetirse en pagos (incluye anulados); ver migracion `20260713050000_transferencia_unica_global.sql`.
- Se agregan `capture_user_id` y `capture_device_label` en `public.cash_shifts`.
- Las imagenes se guardan solo en Supabase Storage privado.
- PostgreSQL guarda solo metadatos y trazabilidad.
- El frontend nunca decide el `object_path`.
- El backend genera el path fijo:
  `branches/{branch_id}/cash-sessions/{cash_session_id}/payments/{payment_id}/{proof_id}.jpg`

## Maquina De Estados

- `pending -> opened`
- `opened -> uploaded`
- `uploaded -> approved`
- `uploaded -> rejected`
- `pending/opened -> expired`
- `pending/opened -> canceled`

Reglas:

- Si el token expira, la solicitud no puede reabrirse.
- Si el pago se anula o la caja se cierra, la solicitud se cancela.
- Un rechazo crea una nueva solicitud de recaptura.
- La foto solo se persiste cuando el usuario toca `Usar foto`.
- `Volver a tomar` limpia el preview local y no deja archivo previo en backend ni storage.

## Seguridad Aplicada

- Autenticacion obligatoria en todos los endpoints.
- Resolucion del usuario actual contra Supabase Auth con el bearer token recibido.
- Autorizacion por sucursal, modulo y caja usando tablas reales del POS.
- Solo `image/jpeg`, `image/png` y `image/webp`.
- Validacion real con Pillow; no se confia en extension ni en `content_type`.
- Reescritura a JPEG limpio, con correccion EXIF y sin metadata sobrante.
- Hash SHA-256 del archivo final.
- Bucket privado obligatorio.
- URLs de lectura firmadas y temporales.
- Auditoria de actor, IP y `user-agent`.
- Manejo de rollback: si DB falla despues del upload, se intenta borrar el objeto en Storage.

## Supabase Storage

Bucket esperado:

- `payment-proofs` privado

SQL sugerido en Supabase para crear el bucket:

```sql
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;
```

Politicas minimas sugeridas:

- No dar permisos directos de insert/update/delete al frontend autenticado.
- Si necesitas lectura directa desde Storage, limitarla a service role.
- La lectura de usuarios finales debe pasar por signed URL backend.

Motivo:

- El frontend no recibe `SUPABASE_SERVICE_ROLE_KEY`.
- El cliente no puede forzar rutas ni sobreescribir archivos de otros pagos.
- El backend centraliza validacion de imagen, permisos, expiracion y auditoria.

## QA Checklist

- Foto borrosa y rechazo con nueva recaptura.
- Preview local visible antes de subir.
- `Volver a tomar` limpia preview anterior.
- Token expirado.
- Caja cerrada antes del upload.
- Pago anulado antes del upload.
- Doble submit sobre el mismo token.
- Red lenta o subida interrumpida.
- Archivo corrupto o no imagen.
- Imagen girada por EXIF.
- Usuario movil no autorizado.
- Supervisor o cajero principal visualizando el comprobante aprobado o pendiente.

## Notas De Adaptacion

- El backend nuevo convive con el POS actual React/Supabase sin romperlo.
- Los componentes Vue se dejan desacoplados para montarlos como microfrontend o app complementaria.
- Si luego decides mover el POS completo a Vue, este modulo ya queda en el stack solicitado.
