/**
 * Envío rápido y manual de un email "tu pedido está en camino" con el look & feel
 * de Fewya, vía la API de Resend. Script autónomo (no depende del Worker ni de
 * astro:env), pensado para mandar un correo puntual a un cliente.
 *
 * Uso:
 *   RESEND_API_KEY=re_xxx bun run scripts/send-shipped-email.ts \
 *     --to "cliente@ejemplo.com" \
 *     --name "Lucía" \
 *     --order "ORD-12345" \
 *     --tracking "https://tracking.transportista.com/abc" \
 *     --address "Calle Mayor 10, 3ºB, 28013 Madrid" \
 *     [--shop "Mi Tienda"] \
 *     [--from "Fewya <no-reply@fewya.com>"]
 *
 * Requisito: el dominio del remitente (fewya.com) debe estar VERIFICADO en Resend
 * para poder enviar a un cliente real. Mientras no lo esté, solo puedes enviarte
 * correos a ti mismo usando --from "Fewya <onboarding@resend.dev>".
 */

import { writeFile } from 'node:fs/promises';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        if (key.includes('=')) {
            const [k, ...rest] = key.split('=');
            out[k] = rest.join('=');
        } else {
            out[key] = argv[i + 1] ?? '';
            i++;
        }
    }
    return out;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildHtml(opts: {
    name: string;
    order: string;
    tracking: string;
    address: string;
    shop?: string;
}): string {
    const saludo = opts.name ? `Hola ${escapeHtml(opts.name)},` : '¡Hola!';
    const tienda = opts.shop ? ` de <strong>${escapeHtml(opts.shop)}</strong>` : '';
    return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:28px 32px 4px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Fewya</p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#111827;font-weight:700;letter-spacing:-0.02em;">Tu pedido está en camino 📦</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 0;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${saludo} buenas noticias: tu pedido <strong>${escapeHtml(opts.order)}</strong>${tienda} ya ha sido procesado.</p>
        </td></tr>

        <!-- Botón de seguimiento -->
        <tr><td style="padding:22px 32px 6px;">
          <a href="${escapeHtml(opts.tracking)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">Seguir el envío</a>
        </td></tr>
        <tr><td style="padding:0 32px;">
          <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">¿El botón no funciona? Copia este enlace:<br><span style="color:#6b7280;word-break:break-all;">${escapeHtml(opts.tracking)}</span></p>
        </td></tr>

        <!-- Dirección de envío -->
        <tr><td style="padding:22px 32px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #eef0f3;border-radius:12px;">
            <tr><td style="padding:14px 16px;">
              <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">Se enviará a</p>
              <p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#111827;">${escapeHtml(opts.address)}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 32px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">Te avisaremos de cualquier novedad. ¡Gracias por comprar en Fewya!</p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Fewya — Marketplace de pequeños negocios</p>
    </td></tr>
  </table>
</body>
</html>`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const apiKey = process.env.RESEND_API_KEY;

    // Modo previsualización: --preview [ruta.html] escribe el HTML y NO envía.
    if ('preview' in args) {
        const html = buildHtml({
            name: args.name ?? 'Lucía',
            order: args.order ?? 'ORD-12345',
            tracking: args.tracking ?? 'https://tracking.ejemplo.com/abc123',
            address: args.address ?? 'Calle Mayor 10, 3ºB, 28013 Madrid',
            shop: args.shop,
        });
        const path = args.preview || '/tmp/fewya-shipped-preview.html';
        await writeFile(path, html, 'utf8');
        console.log(`👀 Previsualización escrita en ${path} — ábrela en el navegador.`);
        return;
    }

    const required = ['to', 'order', 'tracking', 'address'];
    const missing = required.filter((k) => !args[k]);
    if (!apiKey || missing.length > 0) {
        console.error('Faltan datos.');
        if (!apiKey) console.error('  • Define RESEND_API_KEY en el entorno.');
        for (const m of missing) console.error(`  • Falta --${m}`);
        console.error('\nEjemplo:\n  RESEND_API_KEY=re_xxx bun run scripts/send-shipped-email.ts \\\n    --to cliente@ejemplo.com --name "Lucía" --order ORD-123 \\\n    --tracking https://track/abc --address "Calle Mayor 10, 28013 Madrid"');
        process.exit(1);
    }

    const from = args.from || 'Fewya <no-reply@fewya.com>';
    const html = buildHtml({
        name: args.name ?? '',
        order: args.order,
        tracking: args.tracking,
        address: args.address,
        shop: args.shop,
    });

    const payload: Record<string, unknown> = {
        from,
        to: [args.to],
        subject: `Tu pedido ${args.order} está en camino`,
        html,
    };
    // Opcional: dirección a la que llegarán las respuestas del cliente (p.ej. tu Gmail).
    if (args['reply-to']) {
        payload.reply_to = args['reply-to'];
    }

    const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`❌ Resend devolvió ${res.status}: ${body}`);
        process.exit(1);
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`✅ Email enviado a ${args.to}${data.id ? ` (id: ${data.id})` : ''}`);
}

main();
