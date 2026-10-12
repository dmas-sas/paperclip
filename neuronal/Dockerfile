# Imagen de Paperclip de DMAS/Neuronal: la oficial + los archivos fuente que parcheamos en la rama `neuronal`.
# El servidor carga los paquetes del monorepo desde `src/` con tsx, así que reemplazar el .ts alcanza (sin compilar).
# Construir desde la raíz del fork:  docker build -f neuronal/Dockerfile --build-arg PAPERCLIP_VERSION=<tag> -t paperclip-neuronal:<tag> .
ARG PAPERCLIP_VERSION
FROM ghcr.io/paperclipai/paperclip:${PAPERCLIP_VERSION}

# fix(adapter-utils): workspace del sandbox con --no-same-owner (git "dubious ownership") y .paperclip-runtime excluido de git
COPY --chown=node:node packages/adapter-utils/src/sandbox-managed-runtime.ts /app/packages/adapter-utils/src/sandbox-managed-runtime.ts

# fix(adapter-utils): en sandbox, el broker de GitHub va por el puente (localhost:3100 no existe dentro de Modal)
COPY --chown=node:node packages/adapter-utils/src/execution-target.ts /app/packages/adapter-utils/src/execution-target.ts
# fix(adapter-utils): el lanzador de git espera 60 s al broker (el puente de archivos del sandbox tarda 20-50 s por llamada)
COPY --chown=node:node packages/adapter-utils/src/github-launcher.ts /app/packages/adapter-utils/src/github-launcher.ts
# The server runs compiled code: ship the patched dist file next to its source change.
COPY --chown=node:node neuronal/dist/server/services/chat-control-recovery-stop.js /app/server/dist/services/chat-control-recovery-stop.js
