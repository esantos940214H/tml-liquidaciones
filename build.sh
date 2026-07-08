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

echo "build.sh: dist/ generado con 10 sites."
