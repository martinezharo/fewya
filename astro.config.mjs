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
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_KEY: envField.string({ context: 'server', access: 'secret' }),
    }
  },
  vite: {
    plugins: [
      tailwindcss(),
      VitePWA({
        injectRegister: false,
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'Shopenn Marketplace',
        short_name: 'Shopenn',
        description: 'Marketplace moderno para pequeños negocios',
        theme_color: '#ffffff',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: null
      }
      })
    ]
  }
});