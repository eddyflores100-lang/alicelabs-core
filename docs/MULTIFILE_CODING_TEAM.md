# AliceLabs Core — equipo agéntico multiarchivo

## Flujo publicado
1. Abre dos a ocho archivos editables del mismo proyecto en Core Web o Android.
2. Conecta una cuenta API del proveedor y autorízala específicamente para ese proyecto.
3. En el agente, selecciona **Editar** y activa **Edición multiarchivo**.
4. Describe el cambio. Core ejecuta roles secuenciales de planificación, programación y revisión mediante el proveedor elegido. Si el revisor informa problemas se hace una corrección y una segunda revisión, con máximo cinco llamadas API.
5. El programador entrega un JSON estructurado que se valida: rutas EXACTAMENTE iguales a archivos abiertos, sin rutas nuevas, sin borrados, sin duplicados, sin archivos desconocidos y con límites de tamaño.
6. Cada archivo modificado tiene un diff de lectura. Debes marcar **He revisado** para todos antes de aplicar.
7. El lote se aplica en memoria solo si todos los archivos siguen teniendo su contenido original y son editables. Si uno cambió entretanto, no se aplica ninguno.
8. En GitHub, también puedes crear un **Pull Request multiarchivo** sin tocar la rama principal. Core vuelve a comprobar SHA de cada archivo contra GitHub, obtiene el árbol base, preserva los permisos de archivo, crea los blobs de todos los archivos, un único árbol y commit, una rama nueva y un PR.

## Límites y seguridad
- Máximo ocho archivos abiertos; máximo 12 KB por archivo de origen y aproximadamente 21 KB de contexto original sumado. El contexto de revisor no puede superar 49 KB. El Worker separa pregunta y contenido de archivos para evitar recortes silenciosos.
- No se ejecuta código generado por IA automáticamente ni se modifican archivos sin consentimiento explícito.
- La revisión de IA es un filtro, no garantiza la ausencia de errores; comprueba CI y pruebas en GitHub antes de fusionar.
- El PR multiarchivo usa GitHub fine-grained PAT del propietario exclusivamente en memoria. Los secretos permanecen en la API del proveedor correspondiente; no se guardan en el repositorio.
- El PR permite entre dos y ocho archivos **existentes** con SHA original, no crea archivos ni elimina archivos. Los cambios propuestos se conservan para revisión hasta que se apliquen o descarten en memoria; la propuesta de IA no se persiste como tarea remota al cerrar la sesión.
- Puede consumir tokens facturables del modelo y minutos facturables de GitHub Actions. No realiza ejecuciones remotas automáticamente.
- No se debe considerar un reemplazo completo de herramientas autónomas multipaso de repositorio, shell y MCP sin benchmarks reales.

## Pruebas
- Los tests de apps/web/test-multifile-team.mjs cubren cambios de dos archivos, corrección, revisión inválida, duplicados, rutas externas, tamaño y conflictos atómicos.
- Los tests de apps/web/test-github-batch-pr.mjs verifican commit de varios archivos en una rama separada, conservación de modo ejecutable, comprobación de SHA y prevención de escritura ante conflictos, con simulaciones de la API oficial.
- Core CI ejecuta estos tests junto con pruebas existentes de la bóveda, permisos, GitHub, API y runner remoto.
