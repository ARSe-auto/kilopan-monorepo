# Build reproducible de KiloPan.
#
# Se pasó a Dockerfile después de dos builds fallidos en los que el problema nunca fue
# el código, sino qué herramientas elegía el builder por su cuenta:
#
#   1. Sin `packageManager`, eligió pnpm 9. pnpm 9 lee `overrides` desde package.json y
#      pnpm 10+ desde pnpm-workspace.yaml (que es donde están, por AC-SEC-03). No los
#      encontró donde los busca, los vio en el lockfile y abortó el --frozen-lockfile.
#   2. Al fijar pnpm 11, instaló corepack 0.24.1 —de principios de 2024— que no sabe
#      cargar un pnpm 11 (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING).
#
# Acá la versión de Node y la de pnpm son las mismas que en el Mac donde se probó. Un
# despliegue que se comporta distinto al entorno donde se verificó no es un despliegue
# verificado.

# --- etapa de build ---------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

# pnpm directo por npm: corepack agrega una capa que ya falló una vez y no aporta nada
# cuando la versión está fijada acá mismo.
RUN npm install -g pnpm@11.17.0

# Manifiestos primero: mientras no cambien, la capa de dependencias se reusa y el
# build no vuelve a bajar todo el árbol.
#
# Van uno por uno y no `COPY packages packages`, que traería el código fuente y
# anularía justamente esa caché. Son los DOS paquetes reales del workspace: metodo es
# solo scripts (no tiene package.json) y los nucleo-* siguen siendo cáscaras vacías
# hasta el hito de extracción. Cuando alguno de esos se puebla, va una línea acá — si
# se olvida, el build falla nombrando la ruta que falta, que es un error bien claro.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/kilopan/package.json apps/kilopan/
COPY packages/miga/package.json packages/miga/
RUN pnpm install --frozen-lockfile

COPY . .
# El build de kilopan incluye scripts/copiar-estaticos-standalone.mjs, que copia
# .next/static y public/ dentro del standalone. Sin ese paso el servidor responde 200
# en todo (SSR puro) pero la app NUNCA hidrata: ningún botón hace nada.
RUN pnpm --filter kilopan run build

# --- etapa de runtime -------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Sin esto la app se despliega, migra, arranca… y el healthcheck igual falla.
# El server.js del standalone usa process.env.HOSTNAME como dirección de bind, y Docker
# define HOSTNAME con el ID del contenedor. Next queda escuchando en "17345402b546:8080"
# —un nombre que solo resuelve puertas adentro— así que nada de afuera lo alcanza.
# El log dice " ✓ Ready" con toda tranquilidad mientras el healthcheck se agota.
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/kilopan/.next/standalone ./

# db/ va DENTRO de apps/kilopan/ y no en la raíz, aunque en el repo viva en la raíz.
# Razón: pnpm deja `pg` enlazado en apps/kilopan/node_modules/, no en el node_modules
# de la raíz del standalone. Con db/ arriba, migrar.mjs buscaba pg en /app/db/
# node_modules y /app/node_modules —ninguno lo tiene— y el contenedor moría en el
# arranque con "Cannot find package 'pg'". migrar.mjs resuelve sus rutas contra su
# propio archivo, así que encuentra igual db/migraciones/*.sql desde acá.
COPY --from=build /app/db ./apps/kilopan/db

# Nunca root: si algo se cuela por la app, que no tenga la máquina entera.
USER node

EXPOSE 3000
# server.js queda bajo apps/kilopan/ y no en la raíz: outputFileTracingRoot apunta a la
# raíz del monorepo, así que el standalone reproduce la ruta completa del paquete.
#
# Las migraciones corren ANTES de levantar el servidor y con && : si fallan, el
# contenedor no arranca. Es deliberado — una app sirviendo contra un esquema que no
# es el que espera hace daño en silencio, y acá lo que está en juego es evidencia de
# entregas y plata en caja.
CMD ["sh", "-c", "node apps/kilopan/db/migrar.mjs && node apps/kilopan/server.js"]
