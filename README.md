Shopenn es el nombre en clave de un marketplace donde pequeños negocios pueden vender de una forma más profesional que Wallapop o Vinted, pero igual de fácil de usar sin las complicaciones de una propia web o de vender en Amazon.

## Entorno

Para desarrollo local, usa un archivo `.env` con `SUPABASE_URL` y `SUPABASE_KEY`.

En Cloudflare, configura esas mismas claves como variables del Worker desde el dashboard. `wrangler.jsonc` ya no las incluye para evitar duplicar configuracion en texto plano dentro del repositorio.