# Rama `neuronal`

Paperclip tal como corre en la instancia de DMAS/Neuronal: el tag oficial que usa el servidor más nuestros parches,
cada uno en su propio commit para poder reaplicarlo sobre una versión nueva y mandarlo upstream.

| Parche | Dónde se aplica | Upstream |
|---|---|---|
| `plugin-modal`: API de archivos nueva + `safe.directory` | plugin instalado desde carpeta local | [#15381](https://github.com/paperclipai/paperclip/pull/15381) |
| `adapter-utils`: `tar --no-same-owner` al subir el workspace al sandbox + `.paperclip-runtime` en `.git/info/exclude` | imagen derivada (`neuronal/Dockerfile`) | pendiente |

Al subir de versión: rebase de `neuronal` sobre el tag nuevo, correr los tests de los paquetes tocados,
reconstruir la imagen con el `PAPERCLIP_VERSION` nuevo y sacar del Dockerfile lo que upstream ya haya incorporado.
