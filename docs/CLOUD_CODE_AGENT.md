# Core Cloud Coder — ejecución agéntica sobre GitHub Actions

## Funcionamiento

Core Cloud Coder permite iniciar un trabajo de programación remota desde Core Web y Android. Una vez aceptado por GitHub, continúa aunque cierres el navegador o el teléfono.

El propietario selecciona un objetivo y entre dos y seis archivos existentes bajo src/; los límites son 12 KB por archivo y 21 KB de contexto de origen. Tres roles de IA (planificador, programador, revisor) trabajan secuencialmente, con una corrección y revisión adicionales si es necesario. Hay como máximo cinco llamadas al proveedor en una tarea. El código generado no se ejecuta en el job que posee secretos.

Si el revisor acepta, Core crea una rama nueva y un Pull Request. No se fusiona automáticamente ni se modifica la rama principal. El trabajo se detiene si el revisor rechaza el resultado o si la selección de archivos es insegura. GitHub puede mantener los trabajos mientras el usuario está desconectado.

## Configuración por repositorio

1. En GitHub → Settings → Secrets and variables → Actions crea el secreto CORE_AGENT_API_KEY. Usa tu clave personal; no la pegues en el chat ni en ningún commit.
2. En Variables de GitHub Actions puedes configurar CORE_AGENT_PROVIDER (openai, anthropic, openrouter, google, deepseek, groq, mistral o xai) y CORE_AGENT_MODEL. Si no existen se usan openai y gpt-4.1-mini como valores predeterminados.
3. En Settings → Actions → General habilita que GitHub Actions pueda crear PR y concede permisos necesarios al token de workflows. El job de autor tiene contents: write y pull-requests: write; el job de verificación tiene solo contents: read.
4. En Core abre el repositorio autorizado y entra en GitHub Actions → Core Cloud Coder. Describe el objetivo y los archivos seleccionados. Confirma el posible consumo de tokens/minutos y el envío del código de esos archivos al proveedor.
5. Revisa el workflow, la rama y el PR antes de fusionar.

## Reutilización desde otro repositorio

Instala un workflow wrapper manual en el repositorio destino que llame al workflow reutilizable de AliceLabs. Este ejemplo debe guardarse en .github/workflows/cloud-coder.yml de ese repositorio:

    name: Cloud Coding Agent
    on:
      workflow_dispatch:
        inputs:
          goal:
            required: true
            type: string
          files:
            required: true
            type: string
    permissions:
      contents: write
      pull-requests: write
    jobs:
      code:
        uses: eddyflores100-lang/alicelabs-core/.github/workflows/core-cloud-coder.yml@main
        with:
          goal: ${{ inputs.goal }}
          files: ${{ inputs.files }}
        secrets:
          CORE_AGENT_API_KEY: ${{ secrets.CORE_AGENT_API_KEY }}

Antes de instalar workflows reutilizables, verifica que el repositorio de origen sea de confianza y considera fijar una revisión SHA de confianza en lugar de main.

## Límites y seguridad

- Solo rutas existentes de src/ y tipos de texto admitidos. Se rechazan rutas fuera del repositorio, archivos demasiado grandes, symlinks, duplicados y archivos que no sean regulares.
- El job con CORE_AGENT_API_KEY no instala ni ejecuta el código propuesto. Crea una rama y un PR para revisión.
- El job de verificación de AliceLabs Core corre aparte, sin el secreto del proveedor y con token GitHub de solo lectura.
- El archivo fuente seleccionado se envía al proveedor de IA autorizado; no introduzcas secretos en el objetivo o en los archivos elegidos.
- GitHub Actions puede consumir minutos y el proveedor IA puede facturar cada solicitud. No existe ejecución periódica automática ni cron.
- GitHub puede bloquear PR creados por GITHUB_TOKEN según la configuración del repositorio. En ese caso la rama creada se conserva para revisión manual.
- GitHub no necesariamente ejecuta CI a raíz de commits generados por GITHUB_TOKEN; el workflow incluye verificación separada para el repositorio AliceLabs Core.
- Este flujo es acotado, no un motor de ejecución arbitraria de comandos, ni garantía de que los cambios funcionarán; revisa los diffs y tests antes de fusionar.

## Pruebas

tools/cloud-code-agent.test.mjs comprueba filtrado de rutas, symlinks, respuestas de proveedores, errores sin filtración de credenciales, creación de ramas/PR simulados y ausencia de escrituras cuando el revisor rechaza. La interfaz de GitHub Actions también tiene pruebas de selección y despacho del objetivo con entradas validadas.
