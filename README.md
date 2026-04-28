Shopenn es el nombre en clave de un marketplace donde pequeños negocios pueden vender de una forma más profesional que Wallapop o Vinted, pero igual de fácil de usar sin las complicaciones de una propia web o de vender en Amazon.

## Entorno

Para desarrollo local, usa un archivo `.env` con `SUPABASE_URL` y `SUPABASE_KEY`.

Estas dos variables se resuelven en build desde `.env` o `process.env`, por lo que no dependen de bindings runtime del Worker en Cloudflare. Si despliegas desde CI, define `SUPABASE_URL` y `SUPABASE_KEY` en el entorno de build.