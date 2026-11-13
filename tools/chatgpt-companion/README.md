# AliceLabs Core · ChatGPT Companion (OAuth)

Este componente local implementa el flujo oficial [Sign in with ChatGPT para aplicaciones abiertas](https://developers.openai.com/siwc/token-sharing-open-source).

**Objetivo:** conectar una o varias cuentas de ChatGPT mediante su propia pantalla de inicio de sesión, sin claves API manuales, y consumir únicamente el acceso autorizado del plan de esa cuenta. No administra conversaciones existentes de ChatGPT.

Para iniciar desde la raíz del repositorio:

```bash
node tools/chatgpt-companion/server.mjs
```

Abre [AliceLabs Core](https://alicelabs-core.pages.dev), entra en **Conexiones → ChatGPT**, copia el token temporal de la consola local y pulsa **Conectar**. Después pulsa **Continuar con ChatGPT**: el navegador abre la autenticación oficial. Completa la autorización, regresa a Core, pulsa **Actualizar** y selecciona la cuenta.

**Arquitectura:** Pages solo presenta la interfaz. El componente local escucha exclusivamente en 127.0.0.1:39008, restringe orígenes y exige un token aleatorio temporal de emparejamiento. La autorización usa PKCE S256, state y nonce nuevos para cada cuenta, callback HTTP loopback de puerto efímero, validación criptográfica de ID token (JWKS), comprobación de issuer, audience, exp y nonce, además de la autorización de scopes. Los modelos se consultan por cuenta en la API oficial de OpenAI y el chat se procesa por streaming de Responses API con `store:false`.

**Seguridad:** ni los tokens OAuth ni las contraseñas se envían al navegador Pages, a Workers, a GitHub o a logs. Solo se guarda en disco un archivo local de metadatos NO secretos en el directorio privado del usuario: un host ID estable, emails visibles, nombres, identidades verificadas y client IDs. Los access, refresh e ID tokens solo existen en RAM mientras corre el componente. Reautoriza la cuenta tras reiniciar el componente. No expongas el puerto mediante túneles o proxies.

Las sesiones son independientes. No hay rotación automática entre cuentas al agotar límites. Una cuenta conectada no proporciona acceso a modelos de otra cuenta; se consulta el catálogo propio y se mantiene la selección explícita.

**Estado de pruebas:** se puede validar sintaxis, emparejamiento, CORS y endpoints sin iniciar sesión. El OAuth completo y la primera inferencia real requieren consentimiento de una cuenta ChatGPT elegible y deben verificarse en el navegador del titular. Esta integración está sujeta a las condiciones de la vista previa y a los límites de cada plan.

Para aplicaciones comerciales remotas que no cumplan los términos de la integración abierta, solicitar registro de cliente en el programa de OpenAI.
