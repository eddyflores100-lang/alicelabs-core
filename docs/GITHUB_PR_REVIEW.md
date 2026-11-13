# Revisión y fusión de Pull Requests en Core

## Flujo desde web y Android
1. Abre un repositorio de GitHub con un token fine-grained autorizado.
2. Selecciona Revisar y fusionar Pull Requests desde el explorador del proyecto.
3. Elige un PR abierto. Core consulta los detalles y los archivos cambiados mediante la API oficial de GitHub.
4. Revisa los fragmentos de diff y, cuando sea necesario, abre la página oficial para inspeccionar todas las líneas y comprobaciones.
5. Si GitHub indica que el PR está limpio, fusionable, no es borrador y apunta a la rama del proyecto, activa la casilla de revisión.
6. Confirma la fusión squash con el número, rama destino y SHA.
7. Core consulta de nuevo los datos oficiales justo antes de fusionar y exige que el SHA de cabecera siga coincidiendo. Si cambió, rechaza la operación.
8. GitHub aplica sus reglas de protección y devuelve el SHA final cuando la fusión tiene éxito.

## Permisos
Consultar PR y archivos: Pull requests: Read del repositorio elegido.
Fusionar: Contents: Write del repositorio (más autorizaciones y reglas de la organización). Los PR protegidos o las colas de fusión pueden requerir operar desde GitHub.

## Límites de seguridad
- Core no fusiona automáticamente ni ignora requisitos de revisión de GitHub.
- El botón solo se habilita si el PR está limpio y fusionable. En caso de duda se vuelve a validar.
- No admite fusión con SHA cambiado y requiere otra revisión.
- Solo muestra hasta 60 archivos de los primeros 100 devueltos por GitHub, y hasta 3800 caracteres de diff por archivo. Para diff completo, abrir GitHub.
- Las credenciales GitHub viven solo en memoria y nunca se imprimen en mensajes, URLs ni registros.
- Los propietarios deben revisar resultados de CI y revisores requeridos en la página oficial del PR.

## Pruebas
Las pruebas en apps/web/test-github-pull-requests.mjs cubren listado, URLs ajenas, límites de diff, condiciones de fusión, validación de SHA justo antes de fusionar, rechazo de nuevas revisiones, bloqueos y falta de token. Están incluidas en Core CI.
