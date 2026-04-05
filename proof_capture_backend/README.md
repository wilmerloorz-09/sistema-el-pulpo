# Payment Proof Backend

Backend FastAPI para capturar, validar, almacenar y aprobar comprobantes de transferencia.

## Variables de entorno

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET_PAYMENT_PROOFS`
- `PAYMENT_PROOF_MAX_FILE_SIZE_MB`
- `PAYMENT_CAPTURE_TOKEN_TTL_MINUTES`
- `PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS`

## Ejecutar migraciones

```bash
alembic upgrade head
```

## Ejecutar API

```bash
uvicorn app.main:app --reload
```
