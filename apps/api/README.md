# AliceLabs Core Agent API

Cloudflare Worker sin estado que conecta proveedores de modelo con credenciales aportadas por cada usuario (BYOK): OpenAI, OpenRouter, Anthropic, Google Gemini. No almacena claves ni archivos; responde al chat o devuelve una propuesta de contenido revisable.

Rutas: `GET /api/health` y `POST /api/agent`.

Las solicitudes desde navegador se restringen al dominio de Cloudflare Pages `alicelabs-core.pages.dev` (incluidas previews) y hosts de desarrollo locales. Para usar dominio personalizado, actualizar la lista de orígenes antes de publicarlo.

`POST /api/agent` acepta JSON: `{provider,model,apiKey,action,question,path?,code?,history?}`; `action` es `chat` o `edit`. La respuesta es `{ok:true,answer,model,durationMs}`.

Recomendado: introducir autenticación multiusuario antes de habilitar proveedores facturados a la cuenta de AliceLabs, guardado de historial en Cloudflare o herramientas remotas. En esta versión los costos son de las claves del usuario, nunca de una clave común.

## Model discovery y planificador de guía (v1.1)

- POST /api/models: {provider, apiKey} y devuelve catálogo normalizado con ID, contexto, precio si disponible y ranking de OpenRouter, además de la cuota que la API publica.
- Para OpenRouter se verifica primero la clave en el endpoint de autenticación. La consulta pública de modelos por sí sola no prueba acceso.
- POST /api/agent admite action: chat, edit o guide. El plan guide devuelve summary y steps validados contra una lista cerrada de acciones de UI.
- OpenAI usa Responses API y store:false. El Worker no recibe una lista de cuentas, ni reintenta con perfiles alternativos ante 401/429.
- Sin ejecución de shell, rotación de identidades, fingerprints ni proxies de evasión. Las cuentas y preferencias viven en la web apps/web/src/routing.ts y memoria de la pestaña.

Pruebas: pnpm --filter @core/agent-worker test.

## DeepSeek API (v1.2)

Ahora el Worker admite `provider=deepseek`. El descubrimiento autenticado consulta `GET https://api.deepseek.com/models` y selecciona únicamente modelos de respuesta de texto. La generación utiliza `POST https://api.deepseek.com/chat/completions`, con clave API aportada por el usuario en cada solicitud y sin guardar credenciales.

Este método **no** consume la cuenta del chat web de DeepSeek ni crea una sesión con su correo. No existe en esta implementación OAuth de chat reutilizable por una tercera IDE. Cada clave pertenece a un perfil explícito; no hay reintentos por otras cuentas para evitar rate limits.

La suite del Worker incorpora pruebas de DeepSeek con fetch simulado para catálogo, respuestas y ausencia de credenciales en los resultados. Las solicitudes reales requieren una clave del titular y no se han probado con una cuenta de producción.
