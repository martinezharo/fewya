# Ten siempre en cuenta estas reglas y conceptos:

## Coding Standards

- Ten el código más eficiente posible: el código con menos errores es el que no se escribe. Debes buscar la forma más inteligente y escalable de hacer todo lo que te digo.
- Modulariza y componetiza siempre que sea posible, crea archivos separados para componente y funciones que sean propensos de ser reutilizado o simplemente son lo suficientemente complejos para estar en un archivo a parte.
- Haz que el código sea escalable.
- Explica en el chat siempre lo que has hecho y no te cortes en proponer mejoras o reportar malas prácticas o errores que encuentres.
- No hardcodees texto, crea archivos con variables para facilitar futuros cambios o traducciónes.
- Las rutas de las páginas deben estar siempre en inglés.
- Cuando hagas un cambio en la estructura de la base de datos actualiza db-structure y genera un nuevo archivo SQL en una carpeta de migraciones con los cambios listos para ser importados en Supabase.
- NUNCA hagas commits, push o cualquier otra cosa que altere el historial de Git a menos que te lo pida explicitamente.
- Si te pido hacer un commit, sigue las mejores prácticas de Git dividiendo por responsabilidad / categoría / funcionalidad y evitando commits monolíticos. Escribe el mensaje siempre en inglés.

## Fewya

### Producto
- Será una PWA Mobile First en la sección de compras, actua más cómo si estuvieses desarrollando una app móvil nativa que una web.
- La sección de vendedor se centrará en tener una buena experiencia en escritorio.
- Sección de comprador y vendedor separadas a nivel de usuario pero compartiendo el código necesario para aumentar eficiencia.

### Ideas concepto
- Marketplace donde pequeños negocios pueden vender de una forma más profesional que Wallapop o Vinted, pero igual de fácil de usar sin las complicaciones de una propia web o de vender en Amazon.
- El comprador puede comprar directamente y confianza sin chatear, con información clara y variantes en un clic.
- “Amazon deshumaniza al vendedor. Wallapop sobrehumaniza la transacción.”
- Compras al vendedor, no a la plataforma. Debe quedar claro.
- Objetivo: Democratizar el eCommerce.
- Enfocado en productos nuevos, no segunda mano.
- El comprado paga por lo que ve, productos y envío. Comisiones y seguros corren a cargo del vendedor.
- Dar más libertad de gestión al vendedor (como Shopify) y que gestione todo como crea conveniente a nivel políticas.

### Diseño
El diseño del marketplace debe ser extremadamente profesional y ultramoderno. Tiene que tener una estética minimalista y moderna a la altura de Notion, OpenAI, Revolut o Apple.
Haz siempre versiones para modo claro y modo oscuro.

## Stack

### Core
- **Framework:** Astro (SSR activado para Cloudflare/Supabase).
- **Lenguaje:** TypeScript.
- **Estilos:** Tailwind CSS

### Infraestructura y Backend
- **Despliegue:** Cloudflare Workers.
- **Base de Datos:** Supabase (PostgreSQL).
- **Autenticación:** Supabase Auth (Inicialmente solo Google).

### Herramientas de Desarrollo
- **Gestor de paquetes:** Bun.
- **Linter:** ESLint con `eslint-plugin-astro`.
- **PWA:** `vite-plugin-pwa` para funcionalidad offline e instalación.