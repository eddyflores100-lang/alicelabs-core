# AliceLabs Core Agent API

Cloudflare Worker sin estado que conecta proveedores de modelo con credenciales aportadas por cada usuario (BYOK): OpenAI, OpenRouter, Anthropic, Google Gemini. No almacena claves ni archivos; responde al chat o devuelve una propuesta de contenido revisable.

Rutas: `GET /api/health` y `POST /api/agent`.

Las solicitudes desde navegador se restringen al dominio de Cloudflare Pages `alicelabs-core.pages.dev` (incluidas previews) y hosts de desarrollo locales. Para usar dominio personalizado, actualizar la lista de orígenes antes de publicarlo.

`POST /api/agent` acepta JSON: `{provider,model,apiKey,action,question,path?,code?,history?}`; `action` es `chat` o `edit`. La respuesta es `{ok:true,answer,model,durationMs}`.

Recomendado: introducir autenticación multiusuario antes de habilitar proveedores facturados a la cuenta de AliceLabs, guardado de historial en Cloudflare o herramientas remotas. En esta versión los costos son de las claves del usuario, nunca de una clave común.
