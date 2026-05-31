const fs = require('fs');

const text = `
### Actualizacion May 31, 2026
- **Aplicacion Nativa y Nube:** La aplicacion ahora funciona mediante un contenedor nativo (Capacitor) instalado en las tablets, configurado (\`capacitor.config.ts\`) para consumir directamente la aplicacion desde Vercel (servidor en la nube).
- **Impresion Nativa ESC/POS:** Implementacion de un puente nativo de impresion termica usando \`@deedarb/capacitor-tcp-socket\`. Esto permite enviar comandos ESC/POS binarios directamente desde el telefono/tablet a la IP de la impresora en la red local (\`192.168.1.100:9100\`), resolviendo el bloqueo de mixed content y limitaciones de CORS de navegadores web. Se aplico un parche local al codigo Java del plugin para asegurar retrocompatibilidad con versiones de Android menores a la 8.0, y un retraso temporal de 500ms al cerrar el socket TCP para prevenir perdida de datos en procesadores ultrarrapidos.
- **Politicas de Seguridad (RLS):** Se introdujo la migracion \`20260530204919_allow_caja_update_orders.sql\` para permitir a los usuarios con rol de \`caja\` (cajeros sin capacidad de crear mesas) realizar actualizaciones en las ordenes (especificamente \`orders.special_total_manual\`), asegurando que puedan cobrar y manipular valores manuales en ordenes especiales sin requerir permisos de mesero.
- **Area Segura (Safe Area):** Ajustes en \`AppLayout.tsx\` usando \`env(safe-area-inset-top)\` y \`viewport-fit=cover\` en \`index.html\` para evitar que las pantallas modernas edge-to-edge superpongan la barra de estado de Android/iOS sobre la UI de la aplicacion movil.
`;

const files = [
  'docs/system_context.md',
  'docs/PROJECT_ARCHITECTURE.md',
  'docs/database_architecture.md',
  'docs/codex_rules.md'
];

files.forEach(f => {
  fs.appendFileSync(f, text);
});
