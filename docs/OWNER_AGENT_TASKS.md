# AliceLabs Core — cuentas del propietario y motor de tareas

## Funciones implementadas

**Cuentas del propietario.** Las conexiones API viven en memoria compartida de la aplicación, no duplicadas en cada ventana. Cada proyecto concede permisos explícitos a cuentas concretas. Los perfiles están protegidos opcionalmente por una bóveda cifrada con contraseña. La sincronización remota del sobre cifrado requiere activar el servicio privado de Cloudflare.

**Equipo de subagentes.** En modo Editar con API, un planificador, programador y revisor trabajan en secuencia, con una revisión adicional tras una corrección si se detectan problemas. Máximo cinco llamadas API por solicitud. La propuesta se muestra en el diff y no se aplica sin consentimiento. Cuando el veredicto del revisor es negativo, el botón Aplicar queda deshabilitado. Estos son roles de trabajo con la conexión elegida, no múltiples empresas o identidades simuladas.

**Planes generados por IA.** Desde Nube privada se puede solicitar un plan de verificación al modelo seleccionado. Se admiten únicamente los pasos git-status, git-diff, git-log, node-version, pnpm-test, pnpm-build y pnpm-typecheck. Las propuestas se validan en Worker y en el runner; no se aceptan scripts o comandos arbitrarios.

**Colas persistentes.** El backend autenticado de Durable Objects ofrece rutas GET y POST para /v1/projects/:projectId/tasks, GET y DELETE para /tasks/:id y POST para /tasks/:id/cancel. Ejecuta un solo paso por alarma programada, persiste el progreso y se detiene ante errores. Los resultados son de hasta 8 KB por paso, máximo ocho pasos y treinta trabajos por proyecto. Un trabajo interrumpido se marca fallido en lugar de repetir comandos de forma automática. Proyectos y propietarios distintos usan namespaces independientes.

**Avisos.** Si el servicio oficial de WhatsApp está configurado, envía un aviso al completar el plan entero, sin copiar el código y respetando consentimiento y limitación de frecuencia.

## Activación de infraestructura

El runner privado aún NO está desplegado porque Cloudflare Access no está habilitado y Containers requiere configuración y aprobación de costos. No permitir un endpoint de ejecución pública es una medida deliberada de seguridad. La aplicación mostrará el panel remoto solo cuando VITE_CORE_REMOTE_URL esté configurada con un host autorizado.

## Pruebas

- Validación y rechazo de pasos no permitidos.
- Roles de planificación, edición, revisión y corrección simulados.
- Peticiones no autenticadas rechazadas; aislamiento entre propietarios.
- Simulación de alarmas, progreso, cancelación, eliminación y resultados.
- Pruebas Worker API, WebCrypto, Rust y compilaciones web y Android mediante CI.

## Límites conocidos

Las autorizaciones de perfiles guardadas en el navegador son un control UX y no una barrera robusta frente a XSS. Las pruebas con modelos son simuladas salvo cuando se conectan cuentas reales. El editor todavía no ejecuta un agente programador totalmente autónomo sobre repositorios completos ni todas las CLI oficiales en contenedores. No se afirma superioridad frente a Cline, Aider, OpenCode o Continue sin evaluaciones equivalentes.
