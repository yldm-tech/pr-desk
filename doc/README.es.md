# PR Desk

[English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español**

[![CI](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/releases)
[![Go](https://img.shields.io/badge/Go-1.26.8-00ADD8?logo=go&logoColor=white)](../apps/api/go.mod)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](../apps/web/package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3.4-000000?logo=bun&logoColor=white)](../package.json)
[![Stars](https://img.shields.io/github/stars/yldm-tech/pr-desk?style=flat)](https://github.com/yldm-tech/pr-desk/stargazers)

Un panel de PR de GitHub que puedes alojar tú mismo para detectar comprobaciones fallidas, solicitudes de cambios y conflictos de fusión en tus contribuciones, con historial de actividad y sincronización en segundo plano.

## Funciones

- Encuentra tus PR con comprobaciones fallidas, cambios solicitados o conflictos de fusión en la vista de asuntos pendientes y filtra por repositorio.
- Explora contribuciones entre repositorios, busca PR y consulta la actividad de revisión.
- Conecta GitHub para importar el historial automáticamente; consulta el progreso y la fecha de la última sincronización correcta. Las actualizaciones continúan en segundo plano aunque cierres la página.
- Revisa el acceso a repositorios privados e instala tu GitHub App en los repositorios que quieras consultar.

PR Desk se centra actualmente en los PR que has creado. No es una bandeja de entrada completa de todos los PR en los que te han solicitado una revisión.

## Primer inicio

1. Copia `.env.example` a `.env` y genera un `TOKEN_ENCRYPTION_KEY` único con `openssl rand -hex 16`.
2. Crea una GitHub App y configura su ID de cliente, secreto de cliente y slug en `.env`. Registra `http://localhost:8080/api/v1/auth/github/callback` como URL de retorno. Para una instancia alojada, registra su URL de retorno HTTPS exacta.
3. Ejecuta `docker compose up -d --build`, abre `http://localhost:8080` y conecta GitHub. La primera importación puede tardar varios minutos.

Los PR privados requieren instalar la App en los repositorios correspondientes con permisos de lectura para Pull requests, Checks y Commit statuses. Consulta la [configuración y operación](../docs/development.md), el [tratamiento de datos](../docs/privacy.md) y las [recomendaciones de seguridad](../SECURITY.md). Las credenciales de base de datos de Compose son ejemplos para desarrollo local; ambos puertos publicados se vinculan a la interfaz de bucle local.

## Estructura del repositorio

```text
apps/
  api/                  API Go, modelos PostgreSQL y pruebas
  web/                  Frontend React/Vite y pruebas
doc/                    Traducciones del README
docs/                   Desarrollo, operación y decisiones de bibliotecas
scripts/                Utilidades de copias de seguridad y CI
.github/workflows/      Comprobaciones de CI y publicación condicionada de imágenes
```

Vite+ (`vp`) proporciona los comandos de desarrollo, compilación, pruebas, formato y lint. Bun gestiona el espacio de trabajo JavaScript desde la raíz; las dependencias de Go permanecen en `apps/api/go.mod`. La compilación Docker usa la raíz del repositorio como contexto.

## Comandos

```sh
vp install --frozen-lockfile
vp run dev              # Servidor de desarrollo web
make api                # API: exporta primero las variables necesarias
vp check                # Formato, lint y comprobación de tipos
vp run test             # Pruebas Go/web y compilación de producción
make build              # Binario dist/pr-desk con recursos web integrados
make production         # Un contenedor de aplicación y PostgreSQL
```

Instala la CLI global `vp` siguiendo la [guía oficial de Vite+](https://viteplus.dev/guide/). Las versiones están fijadas en `package.json` y `.node-version`; la configuración de formato y lint está en `vite.config.ts` en la raíz. Ejecuta `vp fmt` para aplicar formato; el ancho de línea utiliza el máximo de Oxfmt, 320.

Configura la autorización de GitHub App y `.env` antes de conectar. Consulta [desarrollo y operación](../docs/development.md) para la configuración, los puertos, las copias de seguridad y la sincronización en segundo plano.

## CI y publicaciones

Los PR y main ejecutan comprobaciones web, pruebas de condiciones de carrera e integración de Go con PostgreSQL aislado, y la compilación Docker de la aplicación con el frontend integrado en ejecutores alojados por GitHub. Cuando la CI de main termina correctamente, publica una imagen de aplicación en GHCR y una GitHub Release.

Consulta [CI/CD](../docs/ci-cd.md) para los desencadenantes, etiquetas y despliegue mediante imágenes, y las [decisiones de bibliotecas](../docs/library-audit.md) para el inventario de implementación.

## Contribuir

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para las comprobaciones locales y las instrucciones de PR. Informa de vulnerabilidades a través del canal privado descrito en [SECURITY.md](../SECURITY.md).

[![Contributors](https://contrib.rocks/image?repo=yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/graphs/contributors)

[Ver todos los colaboradores](https://github.com/yldm-tech/pr-desk/graphs/contributors). Los avatares los proporciona contrib.rocks y requieren un repositorio accesible públicamente.

## Historial de estrellas

[![Star History Chart](https://api.star-history.com/svg?repos=yldm-tech/pr-desk&type=Date)](https://star-history.com/#yldm-tech/pr-desk&Date)

El gráfico y las insignias públicas estarán disponibles cuando el repositorio sea público. [Ver Stargazers en GitHub](https://github.com/yldm-tech/pr-desk/stargazers).

## Licencia

PR Desk se distribuye bajo la [licencia Apache, versión 2.0](../LICENSE).
