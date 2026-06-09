// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import { VitePWA } from 'vite-plugin-pwa';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  devToolbar: { enabled: false },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'public' }),
      SUPABASE_KEY: envField.string({ context: 'server', access: 'public' }),
      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      APP_MODE: envField.enum({
        context: 'server',
        access: 'public',
        values: ['development', 'production'],
        default: 'development',
        optional: true,
      }),
      STRIPE_SECRET_KEY_TEST: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_SECRET_KEY_LIVE: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_WEBHOOK_SECRET_TEST: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_WEBHOOK_SECRET_LIVE: envField.string({ context: 'server', access: 'secret', optional: true }),
      CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      SENDCLOUD_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SENDCLOUD_API_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      APP_BASE_URL: envField.string({ context: 'server', access: 'public', default: 'https://fewya.com', optional: true }),
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_FROM: envField.string({ context: 'server', access: 'public', default: 'Fewya <no-reply@fewya.com>', optional: true }),
      VAPID_PUBLIC_KEY: envField.string({ context: 'server', access: 'public', optional: true }),
      VAPID_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_SUBJECT: envField.string({ context: 'server', access: 'public', default: 'mailto:no-reply@fewya.com', optional: true }),
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
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null,
        // Push + notificationclick handlers live in a static script that Workbox
        // imports into the generated service worker (keeps generateSW strategy).
        importScripts: ['/sw-push.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:js|css|woff2|woff|ttf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets',
              expiration: { maxAgeSeconds: 2592000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|avif|svg|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 2592000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      }
      })
    ]
  }
});
