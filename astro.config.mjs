// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import { VitePWA } from 'vite-plugin-pwa';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'public' }),
      SUPABASE_KEY: envField.string({ context: 'server', access: 'public' }),
      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      SENDCLOUD_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SENDCLOUD_API_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      SENDCLOUD_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
    }
  },
  vite: {
    plugins: [
      tailwindcss(),
      VitePWA({
        injectRegister: false,
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.webmanifest',
      devOptions: {
        enabled: true,
        suppressWarnings: true,
      },
      manifest: {
        name: 'Fewya Marketplace',
        short_name: 'Fewya',
        description: 'Marketplace moderno para pequeños negocios',
        theme_color: '#F5F7FF',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      }
      })
    ]
  }
});
