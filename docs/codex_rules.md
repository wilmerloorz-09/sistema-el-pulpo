# Codex Rules

## Resumen Ejecutivo
Estas reglas garantizan continuidad arquitectónica entre sesiones y equipos.

## Guía Operativa
### Antes de cambiar código/BD
1. Leer documentación en `docs/`.
2. Analizar estructura real existente.
3. Reutilizar entidades y funciones existentes.
4. Evitar duplicación de tablas o lógica paralela.

### Al tocar usuarios/permisos
- Tratar roles administrativos y módulos operativos como capas separadas.
- Validar siempre: `profiles`, `user_roles`, `user_branches`, `user_branch_modules`.
- Confirmar que navegación y módulos visibles coincidan con sucursal activa.

### Al tocar pagos
- Mantener separación entre orden/pago/cancelación/reverso.
- Respetar regla de suma de métodos = total de pago.

## Detalle Técnico
### Reglas obligatorias
- Cambios de BD solo por migraciones seguras.
- Validaciones críticas en backend/BD.
- Mantener compatibilidad con datos existentes.
- Preservar trazabilidad en cambios administrativos.

### Contexto vigente que no debe romperse
- Superadmin inicial protegido.
- Login por email o username.
- Reset excepcional de usuarios fuera de flujo normal.
- Acceso por módulos por sucursal.

## Checklist de Entrega en tareas grandes
1. Cambios BD (migraciones, impacto).
2. Cambios backend (RPC/Edge Functions).
3. Cambios frontend (pantallas/flujo).
4. Pasos manuales (deploy/config).
5. Plan de pruebas.
