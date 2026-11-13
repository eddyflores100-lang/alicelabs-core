# AliceLabs Core Web

La interfaz web funciona en Cloudflare Pages (no depende de Tauri). Cloudflare Workers procesa las peticiones a proveedores de IA (BYOK).

## Funciones operativas

- Abrir carpetas locales en Chrome / Edge usando File System Access API.
- Leer, editar, crear y guardar archivos de texto. Ctrl+S para guardar.
- Pestañas, búsqueda por nombre/ruta, lista de cambios aún sin guardar y panel de eventos.
- Explorar cualquier repositorio público de GitHub en modo lectura.
- Asistente conectado a OpenAI, OpenRouter, Anthropic y Google mediante el Worker.
- Solicitar edición de un archivo, comparar diff y aplicar el resultado manualmente.
- Terminal local opcional mediante Core Local Bridge: token temporal y aprobación desde la consola local para cada comando.

## Configuración local

```bash
cd apps/web
npm install
npm run dev
```

## Construir para Cloudflare Pages

```bash
cd apps/web
npm install
npm run build
```

Publicar el directorio `apps/web/dist`. El script copia Monaco a `public/vs` durante el build para que no dependa de ningún CDN.

## Backend Cloudflare Worker

`apps/api/src/index.js` implementa `GET /api/health` y `POST /api/agent`. Por defecto el frontend usa `https://alicelabs-core-agent.eddyflores100.workers.dev`. Si cambia la cuenta, define `VITE_CORE_API` en el build de Pages.

**Protección de credenciales:** claves sólo en la memoria de esta pestaña, no en localStorage, Git, logs, D1, R2, ni Workers KV. Cada usuario facilita su propia clave de proveedor. El Worker no ejecuta herramientas de terminal.

## Limitaciones intencionales

- El acceso GitHub aquí es público y lectura. Privados/commit/push requieren una integración OAuth o GitHub App por usuario todavía pendiente.
- En navegación remota no puede usarse una terminal de la máquina sin un bridge local explícito.
- Un Worker no ofrece Linux shell. Para agentes con comandos remotos es necesaria una ejecución aislada (Cloudflare Sandbox/Containers) con autenticación, permisos y presupuesto.
- La edición propuesta por modelo no se guarda automáticamente; requiere revisión, aplicación y Ctrl+S.
- La carpeta local no se sube automáticamente a Cloudflare. Sólo se transmite contenido de archivo activo cuando el usuario lo incluye en la consulta o selecciona edición.

Seguridad del Bridge: se escucha sólo en `127.0.0.1:39007`; requiere token aleatorio de sesión, origen Pages autorizado y confirmación `SI` en terminal por cada comando. **No exponer el puerto a internet ni usar túneles.**

## Auto routing y cuentas múltiples (v1.1)

- Se admiten varias conexiones con diferentes claves API del mismo proveedor; cada una lleva su alias.
- Al añadir una clave se comprueba su validez y se consultan los modelos disponibles para ese perfil mediante el Worker.
- El selector ofrece prioridad de calidad, equilibrada o económica, cuenta automática/manual y modelo automático/manual.
- La selección de calidad es heurística: depende de familia, disponibilidad del catálogo, precio cuando se publica, velocidad aproximada y preferencias. No es una evaluación definitiva de modelos.
- Las claves solo residen en memoria de la pestaña y se pierden al recargar. No se escriben en localStorage, KV, D1, R2, logs ni cookies.
- No hay cambios de cuenta automáticos ante errores 401 o 429, ni se crean proxies o fingerprints para evitar restricciones.
- El modo Guia produce pasos y acciones de interfaz permitidas (abrir carpeta, GitHub, buscar, configurar, terminal, guardar y proponer una edición). Solo se activan al pulsarlas.
- El mapa de rutas del proyecto solo se envía al habilitar Mapa proyecto. El contenido del archivo se envía al marcar Archivo o elegir Editar.
- La guía no es un runtime autónomo: no ejecuta herramientas, tareas programadas, cambios Git ni comandos por sí sola.

Ejecutar las pruebas del backend: pnpm --filter @core/agent-worker test.

Pruebas del selector de modelos: pnpm --filter @core/web test:routing (Node 24 recomendado).

## ChatGPT por correo — sin clave API (v0.4, integración beta)

AliceLabs Core incluye una conexión alternativa a las API keys: **Continuar con ChatGPT** mediante el flujo oficial OAuth para aplicaciones abiertas, sujeto a disponibilidad y elegibilidad del plan.

1. En la raíz de este repositorio, inicia `node tools/chatgpt-companion/server.mjs` en tu propio equipo (Node.js 24).
2. Abre https://alicelabs-core.pages.dev y selecciona `ChatGPT con correo` → `Conectar ChatGPT`.
3. Pega el **token de emparejamiento local** que aparece en el terminal **solo dentro de la IDE**. No compartas el token ni la contraseña en chats.
4. Pulsa `Continuar con ChatGPT`, completa la autenticación y los permisos en la **web oficial de OpenAI**, regresa a la IDE y pulsa `Actualizar`.
5. Selecciona la cuenta y uno de los modelos que la cuenta tiene autorizados. Puedes añadir otras cuentas siguiendo el mismo procedimiento, con sesiones independientes.

**Arquitectura y seguridad:** Pages muestra la interfaz, Workers sigue sirviendo el modo BYOK, y el componente `tools/chatgpt-companion` se encarga localmente del OAuth, tokens, modelos y respuestas ChatGPT, sin entregar las credenciales a Pages/Workers. Tokens únicamente en RAM; tras reiniciar el componente, vuelve a autenticar. No se usan cookies copiadas, contraseñas, proxies ni rotación automática para eludir límites. No da acceso a conversaciones existentes de ChatGPT. No todos los tipos de cuentas/planes son necesariamente elegibles.

**Estado:** se ha probado el emparejamiento, restricciones de origen, creación de URL OAuth y build web. La autenticación de una cuenta real y la inferencia con su plan todavía requieren una autorización manual del titular; no se consideran verificadas de extremo a extremo.

Ver [guía del componente ChatGPT](../../tools/chatgpt-companion/README.md).

## Centro universal de conexiones (v0.5)

Desde el botón **Conectar mis IA** o el menú de ajustes se abre un centro que muestra el estado real de cada proveedor.

- **ChatGPT:** integración OAuth de código abierto desarrollada en beta con componente local y múltiples registros independientes, sujeta a autorización de la cuenta y disponibilidad del servicio. No se utilizan tokens en Pages ni Workers.
- **Gemini:** instrucciones y comando para ejecutar el **Gemini CLI original** con inicio de sesión de Google en su propio proceso. Google prohíbe reutilizar el OAuth de Gemini CLI para alimentar clientes externos. No hay conexión directa de cuenta Google a Core Agent.
- **Claude:** instrucciones y comando para el **Claude Code original** con inicio de sesión nativo. Anthropic no permite que una aplicación de terceros use credenciales de suscripción Claude.ai como su propio backend. No se importan tokens.
- **DeepSeek:** el chat web de DeepSeek sigue independiente; Core Agent sí puede consultar directamente modelos y completar solicitudes por API con una clave legítima de cada cuenta.
- **OpenRouter, OpenAI, Anthropic, Google y DeepSeek:** perfiles API separados en memoria, con varias claves por proveedor; la ruta inteligente selecciona solo modelos anunciados por esas cuentas.

El centro no muestra una herramienta CLI como cuenta conectada a Core Agent. El botón copiar coloca el comando correspondiente en el portapapeles; **se ejecuta en una terminal nativa**, no en la terminal de una página web. No se crean perfiles de dispositivo falsos ni se evaden cuotas o restricciones.

Referencias oficiales: https://developers.openai.com/siwc/token-sharing-open-source ; https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md ; https://code.claude.com/docs/en/legal-and-compliance ; https://api-docs.deepseek.com/api/list-models/ .
