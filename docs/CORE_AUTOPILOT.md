# AliceLabs Core Autopilot — cola GitHub cada cinco minutos

## Objetivo y control del propietario

Core incluye un workflow GitHub Actions con cron de cinco minutos: */5 * * * *. Cada ejecución programada, cuando esté activada expresamente, examina una cola de tareas aprobadas por el propietario. GitHub puede retrasar, omitir o deshabilitar ejecuciones programadas; no garantiza intervalos exactos y no reabre un chat de ChatGPT.

La programación queda desactivada por defecto. El workflow necesita dos variables iguales a true: CORE_AUTOPILOT_ENABLED y CORE_AUTOPILOT_CODING_ENABLED. Si cualquiera falta o es false, no reserva tareas ni utiliza runners para programar código. También necesita el secreto CORE_AGENT_API_KEY configurado en GitHub Actions.

## Qué hace cada ciclo autorizado

1. Comprueba las dos variables y la presencia de API key del proveedor.
2. Cuenta los Issues reservados y actualizados desde las 00:00 UTC. Admite de una a tres tareas nuevas al día, con valor predeterminado de dos. Cuando el límite se alcanza no llama a la IA.
3. Inspecciona Issues abiertos con etiqueta exacta core-agent:approved. Solo permite tareas de OWNER, MEMBER o COLLABORATOR del repositorio. El cuerpo debe contener JSON con goal (5–1600 caracteres) y files (2–6 rutas existentes bajo src/, separadas por comas).
4. Reserva una tarea válida con core-agent:claimed. La concurrencia de GitHub Actions impide dos ejecutores simultáneos en el repositorio.
5. Ejecuta Core Cloud Coder con los roles planificador, programador y revisor, máximo cinco solicitudes al proveedor y límites de archivos. Solo crea un PR si el revisor aprueba.
6. Marca el Issue con core-agent:review cuando crea el PR o con core-agent:failed al fallar. No reintenta automáticamente tareas fallidas. La fusión es siempre humana.

## Utilizarlo desde la web o Android

1. En la ventana de proyecto abre el repositorio GitHub con credencial autorizada del propietario. Para controlarlo desde Core necesitas permisos mínimos del repositorio para Contents, Pull requests, Issues, Actions y Variables.
2. Abre GitHub Actions y selecciona Core Autopilot.
3. Indica un objetivo y dos a seis archivos existentes bajo src/. Crea una tarea aprobada para guardar la autorización como Issue.
4. Elige límite de una, dos o tres tareas diarias y pulsa Activar con límite diario tras comprobar gastos potenciales. Core escribe las variables oficiales de GitHub.
5. Para detener tareas futuras pulsa Desactivar autopiloto. Se desactiva primero la programación pagada y luego el programador. Los trabajos ya iniciados pueden continuar; se cancelan desde GitHub Actions.

## Configuración previa

GitHub debe tener el secreto de repositorio CORE_AGENT_API_KEY con tu credencial API autorizada. No se guarda en Core ni se incluye en commits. Las variables opcionales CORE_AGENT_PROVIDER y CORE_AGENT_MODEL eligen proveedor/modelo. En Settings → Actions deben permitirse los permisos de creación de Pull Requests si tu repositorio admite esa opción.

GitHub Actions y proveedores pueden cobrar por los minutos y tokens usados. El límite diario controla número de tareas, NO es un límite monetario en dólares.

## Ejemplo de cuerpo de Issue aprobado

    {
      "goal": "Corrige el tipado y actualiza las pruebas del componente",
      "files": "src/components/Card.tsx,src/components/Card.test.ts"
    }

La etiqueta core-agent:approved es un permiso explícito del propietario, no autorización para comandos arbitrarios. Core rechaza Issues de autores ajenos, pull requests, rutas externas y archivos binarios.

## Restricciones

- El cron no reanuda el chat de ChatGPT ni genera nuevas tareas por sí solo; trabaja exclusivamente con Issues aprobados.
- Los trabajos pueden consumir API y minutos de CI. Por defecto ninguna tarea pagada queda habilitada.
- El conteo diario es conservador: Issues anteriores actualizados hoy pueden consumir cupo del día, reduciendo trabajo. Nunca eleva el límite por encima de tres.
- GitHub puede retrasar los cron, exigir facturación o denegar la creación de PR mediante GITHUB_TOKEN.
- La revisión del modelo no sustituye tests reales ni una revisión humana antes de fusionar.
- Los secretos del proveedor se pasan exclusivamente al job generador de propuestas. Los tests del repositorio Core corren en un segundo job sin el secreto.

## Pruebas

tools/core-autopilot-queue.test.mjs cubre autorizaciones, validación JSON, presupuesto, reservas, cierre y bloqueo de reintentos.
apps/web/test-github-autopilot.mjs cubre creación de Issues desde la web y controles de variables para activar/desactivar.
Core CI ejecuta estas pruebas junto con el resto de pruebas existentes.
