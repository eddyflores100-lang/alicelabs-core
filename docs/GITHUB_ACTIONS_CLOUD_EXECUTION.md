# GitHub Actions desde AliceLabs Core

## Objetivo
Usar GitHub Actions como ejecución remota de **workflows preexistentes** directamente desde Core Web y Android, sin un servidor de contenedores propio y sin necesidad de mantener abierta la página.

## Flujo implementado
1. Abrir un repositorio GitHub público o privado en Core e introducir un token fine-grained emitido por GitHub para ese repositorio.
2. El token requiere Actions: Read para consultar workflows y ejecuciones, Actions: Read and write para iniciar o cancelar workflows. Para editar archivos y crear PR se necesitan permisos Contents y Pull requests respectivamente.
3. En el explorador de proyecto, seleccionar **GitHub Actions · ejecución en la nube**.
4. Escoger un workflow activo en el repositorio.
5. Revisar la confirmación de ejecución: nombre, rama, efectos potenciales, acceso a secretos del repositorio y minutos facturables.
6. Core envía un evento workflow_dispatch oficial con la rama del proyecto, **sin scripts personalizados ni entradas automáticas**.
7. El historial se consulta en GitHub mientras la ventana está abierta. GitHub conserva el estado al cerrar Core.
8. Es posible solicitar la cancelación de ejecuciones pendientes/en curso tras otra confirmación.

## Seguridad y límites
- El token vive solo en la memoria del proyecto hasta desconectar o recargar.
- Se usa HTTPS a api.github.com; no se guardan credenciales en IndexedDB, en el código, en URLs ni en logs.
- Los enlaces de ejecución se validan para que pertenezcan a github.com y al repositorio conectado.
- No se puede iniciar una ejecución sin confirmación del propietario.
- **GitHub Actions ejecuta el contenido real del workflow del repositorio**. Dependiendo del workflow, puede acceder a secretos, desplegar servicios, hacer cambios y consumir minutos facturables. Es responsabilidad del propietario revisar previamente su configuración.
- Solo se ejecutan workflows que tengan habilitado workflow_dispatch; GitHub valida el evento.
- El panel no crea un runner libre de terminal ni reemplaza un entorno privado de Containers. No lanza trabajos por sí mismo.
- Si la versión de GitHub API responde 204, Core reporta la solicitud aceptada sin inventar un ID; si responde 200 con ID, permite abrir la ejecución.
- El historial no es una notificación push al celular; para avisar al cerrar la app requiere integración de notificaciones adicional.

## Pruebas
El archivo apps/web/test-github-actions.mjs contiene mocks para catálogo, permisos, dispatch 200 y 204, validación de URL, seguimiento de resultados, cancelación y errores. También forma parte de Core CI.

La integración de GitHub Actions no requiere Cloudflare Access. La ejecución remota de comandos en contenedores del runner privado de Core continúa aislada y no está desplegada sin autenticación y configuración de infraestructura.
