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
