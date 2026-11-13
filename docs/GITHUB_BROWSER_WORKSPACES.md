# GitHub desde la web y Android — AliceLabs Core

## Capacidades implementadas
- Importar repositorios públicos por URL sin cuenta.
- Inspeccionar repositorios privados con un token fine-grained emitido por GitHub.
- Abrir y editar texto en el editor Monaco o Android.
- Conservar borradores por ventana de proyecto en IndexedDB sin guardar la credencial.
- Preparar archivos nuevos en memoria, editar y crear el archivo remoto cuando el usuario confirme.
- Publicar un commit individual en la rama de trabajo usando el SHA del contenido anterior para evitar sobrescribir silenciosamente cambios concurrentes.
- Crear una nueva rama temporal, subir el archivo y abrir un Pull Request desde el navegador, con revisión humana.
- Desconectar el token de GitHub y convertir los documentos abiertos en modo lectura.
- Reconectar el mismo repositorio sin perder borradores locales.
- Indicar errores de acceso, conflictos de GitHub y ramas protegidas.

## Cuenta del propietario
En la ventana de GitHub, pega un **fine-grained personal access token** creado en GitHub para los repositorios específicos que deseas manejar. Para leer necesitas Contents: Read. Para crear un commit necesitas Contents: Read and write. Para crear una rama y un PR necesitas además Pull requests: Read and write. Nunca pegues una contraseña o una cookie web; no coloques el token dentro de URLs o commits.

El token existe solo en el estado de la ventana de Core hasta que desconectes, cierres la ventana o recargues. La PWA se ejecuta en el dispositivo del usuario y llama a api.github.com directamente con HTTPS. Las claves GitHub **no se guardan** en la bóveda de cuentas IA ni en IndexedDB. Para retomar borradores después de recargar, conecta de nuevo la misma cuenta GitHub.

Esta es una vía BYO-token, **no un flujo OAuth GitHub**. Aún necesita revisiones de XSS, CSP, seguridad de extensiones y de navegador antes de considerarse un gestor de secretos profesional. Los permisos de repositorio los controla GitHub, no la interfaz de Core.

## Dos maneras de publicar
- **Commit:** Guardar / Publicar desde el archivo abierto. La aplicación muestra una confirmación antes de modificar la rama de trabajo. Un conflicto de SHA impide la publicación y conserva el borrador local.
- **Pull Request:** botón GitHub junto a las acciones del editor. Crea una rama nueva y un PR para que el propietario revise y fusione después. El repositorio y la rama principal no cambian al crear el PR. Si el PR falla tras crear la rama, Core informa la rama que debe revisar manualmente.

No se fusionan Pull Requests de forma automática ni se ejecutan comandos arbitrarios. El propietario mantiene el control de los cambios.

## Pruebas automatizadas
El archivo apps/web/test-github-workspace.mjs valida rutas, contenido Unicode, encabezados de autorización, lectura de repositorios privados, SHA de archivos, conflictos, creación de archivos, creación de ramas y PR, y manejo de errores que no muestran credenciales.

## Futuras mejoras
La siguiente etapa es OAuth GitHub App con autorización por repositorio, backend seguro de credenciales y auditorías, edición de lotes, revisiones de PR, comentarios, diff multiarchivo, verificaciones de GitHub Actions y sincronización segura entre dispositivos. No se debe afirmar que esas funciones ya están implementadas.
