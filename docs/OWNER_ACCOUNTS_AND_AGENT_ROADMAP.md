# AliceLabs Core — arquitectura objetivo para identidad, conexiones y agentes

Estado: diseño para implementación incremental. **No describe funciones ya desplegadas**.

## Principios no negociables
- Una identidad propietaria autentica al usuario de Core; **no reemplaza** la autorización oficial de cada proveedor.
- Credenciales personales, API y sesiones CLI se almacenan y administran por mecanismos distintos.
- Una cuenta de ChatGPT, Claude, Google o DeepSeek de consumidor **no da automáticamente acceso API** a una IDE de terceros.
- El uso de CLI oficial y OAuth solo está habilitado cuando el proveedor lo permite expresamente.
- Nunca copiar cookies, tokens de sesión web o secretos desde instalaciones de terceros.
- No rotar identidades para eludir cuotas o bloqueos de proveedores.
- No ejecutar comandos ni enviar mensajes externos sin autorización explícita y registro.

## Entregado en la propuesta feat/owner-encrypted-api-vault
- Guardar y recuperar claves API **localmente** usando AES-GCM 256 y PBKDF2 SHA-256 (310k iteraciones, sal e IV aleatorios).
- Las claves se descifran únicamente al introducir manualmente una contraseña de al menos 12 caracteres.
- El almacenamiento del navegador contiene una envoltura cifrada, nunca una clave API en texto claro.
- Limitaciones: solo el navegador actual; ninguna sincronización remota, recuperación de contraseña, protección frente a XSS activo ni aislamiento de extensiones maliciosas. El usuario debe volver a guardar tras cambios.
- OAuth ChatGPT y CLI no se incluyen en esta bóveda.

## Próximas fases (orden de implementación)

### Fase 1 — identidad del propietario y vault remoto
1. Login propietario con passkeys/WebAuthn y recuperación explícita; MFA para cambios de credenciales.
2. Backend auditable con tablas `owner`, `projects`, `provider_accounts`, `project_grants`, `agent_runs`, `audit_events`.
3. Cifrado de secretos mediante KMS o secret manager; claves no accesibles al frontend después de guardarlas.
4. Sesiones de corta duración, revocación por dispositivo, CSRF/CSP estrictos y registro de accesos.
5. Migración opt-in del vault local; nunca subir claves automáticamente.

**Aceptación:** guardar un perfil en web, iniciar sesión en otro dispositivo y usar el servicio mediante backend sin exponer el secreto al cliente; revocar sesión y permiso de proyecto; logs sin credenciales.

### Fase 2 — proveedores y CLI
1. Matriz por proveedor: `api-key`, `oauth` autorizado, `official-cli` y `none`; catálogo no equivale a conexión.
2. Wizard: elegir identidad propietaria → proveedor → modo autorizado → verificar permiso → vincular proyectos.
3. Adaptadores con capacidades explícitas: chat, herramientas, visión, edición, ejecución y streaming.
4. CLI oficial en contenedor o runner remoto propio **solo bajo condiciones de servicio compatibles**; terminal visible, aprobación por acción sensible y sin exportar tokens oficiales a Core.
5. Healthchecks y métricas de facturación por conexión, con límites de presupuesto.

**Aceptación:** conexión API prueba una llamada real autorizada y muestra modelo, capacidades, errores y gasto; la CLI solo se marca conectada cuando ejecuta una prueba oficial satisfactoria.

### Fase 3 — ejecución agéntica y ventanas
1. Cada proyecto tiene `project_id` y espacio de almacenamiento, historial, memoria, selección de cuentas y runner aislados.
2. Contenedores efímeros por ejecución con cuotas CPU/RAM, acceso a archivos por proyecto, allowlist de red y TTL.
3. Pipeline plan → diff propuesto → aprobación → edición → tests → revisión → commit / PR.
4. Puntos de restauración, diff con rollback, trazas reproducibles y aislamiento de sesiones simultáneas.
5. Herramientas MCP/skills con permisos declarativos y sandbox, nunca confianza por defecto.

**Aceptación:** ejecutar dos proyectos simultáneos; un agente no puede leer secretos, archivos ni historial del otro; un cambio fallido se revierte.

### Fase 4 — móvil, voz y avisos
1. Interfaz móvil para revisar proyectos, dictar tareas y aceptar acciones.
2. Eventos de tareas terminadas por push y correo verificado.
3. WhatsApp exclusivamente mediante integración oficial, consentimiento y plantillas cuando corresponda.
4. La app móvil no necesita permisos irrestrictos del teléfono; solicitar solo permisos concretos cuando se utilicen.

**Aceptación:** una tarea iniciada en la web sigue ejecutándose en un runner autenticado cuando se cierra el navegador y envía notificación al canal opt-in, sin filtrar información del proyecto.

## Referencias competitivas que Core debe superar en pruebas, no en anuncios
- Continue: configuración de modelos, herramientas MCP y reglas por espacio de trabajo.
- OpenCode: selección de proveedores y flujos de agente en terminal.
- Cline y Roo Code: permisos de herramientas, tareas multipaso y revisión de modificaciones.
- Aider: cambios de código con Git, contexto y evaluación de resultados.
- Gemini CLI: experiencia de terminal respaldada por proveedor oficial.

### Métricas comparables
- tasa de tareas de repositorio resueltas con tests verdes;
- número de comandos aprobados frente a no autorizados;
- cero accesos cruzados entre proyectos en tests de aislamiento;
- p50/p95 de latencia del primer token y finalización;
- consumo/costo por tarea y porcentaje de recuperación tras fallo;
- cobertura de adaptadores validados con cuentas reales.

**No declarar superioridad competitiva sin evaluación independiente usando el mismo banco de tareas, mismos modelos y presupuesto equivalente.**
