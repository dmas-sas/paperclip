# Imagen de Paperclip de DMAS/Neuronal: la oficial + los archivos fuente que parcheamos en la rama `neuronal`.
# El servidor carga los paquetes del monorepo desde `src/` con tsx, así que reemplazar el .ts alcanza (sin compilar).
# Construir desde la raíz del fork:  docker build -f neuronal/Dockerfile --build-arg PAPERCLIP_VERSION=<tag> -t paperclip-neuronal:<tag> .
ARG PAPERCLIP_VERSION
FROM ghcr.io/paperclipai/paperclip:${PAPERCLIP_VERSION}

# fix(adapter-utils): extraer el workspace del sandbox con --no-same-owner (git "dubious ownership" en sandboxes root)
COPY --chown=node:node packages/adapter-utils/src/sandbox-managed-runtime.ts /app/packages/adapter-utils/src/sandbox-managed-runtime.ts
