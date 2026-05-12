# Fewya

Fewya es un marketplace moderno orientado a tiendas pequeñas que quieren vender de forma profesional y simple. Esta repo contiene la aplicación PWA (mobile-first para compradores, desktop-first para vendedores) construida con Astro, TypeScript, Tailwind CSS, desplegada en Cloudflare Workers y usando Supabase como backend.
## Resumen
- Propósito: Facilitar a pequeños negocios una experiencia de venta profesional sin la complejidad de construir su propia web.
- Buyer experience: Mobile-first PWA con navegación optimizada para compras.
- Seller experience: Dashboard de escritorio con gestión de productos, pedidos y envíos.
## Tecnologías principales
- Framework: Astro (SSR)
- Lenguaje: TypeScript
- Estilos: Tailwind CSS
- Base de datos: Supabase (Postgres)
- Autenticación: Supabase Auth (Google OAuth)
- Pagos: Stripe (Stripe Connect)
- Despliegue: Cloudflare Workers (wrangler)
- Paquetes y runtime: Bun
- Tests: Vitest

## Estructura del repositorio (resumen)
- `src/` – Código fuente (pages, components, lib)
- `db-structure/` – Esquema y migraciones SQL
- `public/` – Activos estáticos
- `tests/` – Pruebas unitarias con Vitest
- `dev-dist/` – Artefactos para desarrollo (service worker, workbox)
## Requisitos locales
- Bun (recomendado)
- Node.js (opcional para herramientas compatibles)
- Wrangler (para pruebas de Cloudflare Workers localmente)
- Un proyecto Supabase (para ejecutar con datos reales)

## Variables de entorno
Define tus variables en un `.env` o en el entorno del despliegue:

- `SUPABASE_URL` - URL público de Supabase
- `SUPABASE_KEY` - Anon/public key de Supabase
- `SUPABASE_SECRET_KEY` - Service role key (solo en runtime seguro)
- `STRIPE_SECRET_KEY` - Clave secreta de Stripe
- `SENDCLOUD_API_KEY`, `SENDCLOUD_API_SECRET` - Credenciales Sendcloud

Nota: En Cloudflare, configura las variables de entorno/secretos vía `wrangler`.
## Comandos principales
Instalar dependencias:

```bash
bun install
```

Desarrollo (dev server con hot reload):

```bash
bun run dev
```

Build producción:

```bash
bun run build
```

Preview (emula Cloudflare Worker localmente):

```bash
bun run preview
```

Tests:

```bash
bun run test
bun run test:watch
```

Linting y formateo:

```bash
bun run lint
bun run lint:fix
bun run check
```

## Despliegue
Usamos Cloudflare Workers. Flujo típico:

1. Configurar secretos en Cloudflare via `wrangler secrets put`.
2. Ejecutar `bun run build`.
3. Desplegar con `wrangler publish` (o pipeline CI configurado).

Consulta `wrangler.jsonc` para bindings y configuraciones necesarias.
## Base de datos y migraciones
- Los scripts y el diseño están en `db-structure/`.
- Añadir cambios de esquema: crear nuevas migraciones SQL en `db-structure/migrations/`.
- Recomendación: aplicar migraciones en Supabase CLI o a través del panel SQL.

## Testing
- Las utilidades y lógica de dominio tienen tests unitarios en `tests/unit/`.
- Ejecutar `bun run test` para correr la suite.

## Convenciones y buenas prácticas
- Mobile-first para la experiencia de compra; desktop para la parte de vendedor.
- Strings de la UI: centralizadas en `lib/core/i18n.ts`.
- Evitar hardcode; usar variables/env para configuración.
- Seguir las guías en `AGENTS.md` para estructura y estilos.

## Cómo contribuir
- Crear una rama feature: `git checkout -b feat/descripcion`
- Añadir tests unitarios para nueva lógica.
- Ejecutar lint y tests localmente antes de abrir PR.

Checklist para PR:
- Código compilable y tests que pasan
- Lint limpio (`bun run lint`)
- Documentación o notas cuando se cambia la API o DB

## Recursos y archivos útiles
- `AGENTS.md` — Reglas de estilo y estándares del proyecto
- `CLAUDE.md` — Documentación técnica y arquitectura
- `wrangler.jsonc` — Configuración Cloudflare
- `db-structure/` — Migraciones y esquema SQL
