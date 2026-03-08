---
trigger: always_on
---

# Tech Stack: EWYA

## Core
- **Framework:** Astro (SSR activado para Cloudflare/Supabase).
- **Lenguaje:** TypeScript.
- **Estilos:** Tailwind CSS

## Infraestructura y Backend
- **Despliegue:** Cloudflare Pages.
- **Base de Datos:** Supabase (PostgreSQL).
- **Autenticación:** Supabase Auth (Inicialmente solo Google).

## Herramientas de Desarrollo
- **Gestor de paquetes:** PNPM.
- **Linter:** ESLint con `eslint-plugin-astro`.
- **PWA:** `vite-plugin-pwa` para funcionalidad offline e instalación.