Shopenn es el nombre en clave de un marketplace donde pequeños negocios pueden vender de una forma más profesional que Wallapop o Vinted, pero igual de fácil de usar sin las complicaciones de una propia web o de vender en Amazon.

## Entorno

Para desarrollo local, usa un archivo `.env` con:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `STRIPE_SECRET_KEY=sk_test_...`

`STRIPE_WEBHOOK_SECRET` está preparado en la configuración del proyecto, pero el flujo actual confirma el pago al volver desde Stripe Checkout, así que para empezar en modo prueba te basta con `STRIPE_SECRET_KEY`.

Si tu base de datos ya existe, aplica la migración [supabase/migrations/20260428_stripe_connect.sql](supabase/migrations/20260428_stripe_connect.sql). Si partes de cero, [db-structure.sql](db-structure.sql) ya incluye el esquema actualizado.

Estas dos variables se resuelven en build desde `.env` o `process.env`, por lo que no dependen de bindings runtime del Worker en Cloudflare. Si despliegas desde CI, define `SUPABASE_URL` y `SUPABASE_KEY` en el entorno de build.

Para Stripe, define también `STRIPE_SECRET_KEY` en el entorno de build o como secreto de Wrangler en despliegue.