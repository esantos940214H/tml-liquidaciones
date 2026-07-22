#!/usr/bin/env bash
# Genera dist/<site>/index.html para cada site de Firebase Hosting a partir
# de los archivos fuente en la raíz del repo, SIN modificarlos. Cada módulo
# vive en su propio subdominio (site), por eso cada uno se sirve como el
# index.html de su carpeta en dist/.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/portal dist/anticipos dist/cxc dist/liquidaciones dist/nomina dist/incidentes dist/historial dist/usuarios dist/autorizaciones dist/precarga

cp index.html          dist/portal/index.html
cp ant.html            dist/anticipos/index.html
cp ing.html            dist/cxc/index.html
cp liq.html            dist/liquidaciones/index.html
cp nomina.html         dist/nomina/index.html
cp incidentes.html     dist/incidentes/index.html
cp hist.html           dist/historial/index.html
cp usuarios.html       dist/usuarios/index.html
cp autorizaciones.html dist/autorizaciones/index.html
cp precarga.html       dist/precarga/index.html

# LOGO.png solo lo usa el portal (index.html)
cp LOGO.png dist/portal/LOGO.png

# shared/: JS común cargado con <script src="shared/...">. Todos los módulos
# lo usan (login con Firebase Auth, ver shared/sesion.js) excepto el portal
# (index.html no tiene login propio, es solo el menú de acceso a los demás).
for site in anticipos cxc liquidaciones nomina incidentes historial usuarios autorizaciones precarga; do
  cp -r shared dist/$site/shared
done

# version.json: identificador único de este despliegue, usado por
# shared/autoActualizar.js para avisar a pestañas abiertas que hay una
# versión más nueva del sitio. Se genera fresco en cada build.
VERSION_ID="$(date -u +%Y%m%d%H%M%S)"
for site in portal anticipos cxc liquidaciones nomina incidentes historial usuarios autorizaciones precarga; do
  echo "{\"v\":\"$VERSION_ID\"}" > dist/$site/version.json
done

echo "build.sh: dist/ generado con 10 sites (version $VERSION_ID)."
