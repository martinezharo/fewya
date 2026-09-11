// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import AstroPWA from '@vite-pwa/astro';
import clerk from '@clerk/astro';
import { loadEnv } from 'vite';
import { clerkAppearance } from './src/lib/core/clerkAppearance';
import { checkClerkPublishableKey } from './src/lib/core/clerkBuildKey';

/**
 * Refuses to build a bundle Clerk cannot start with.
 *
 * `PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined at build time, so a build run
 * without it — a CI machine with no `.env`, most of all — produces a Worker
 * that redirect-loops on every request. Failing here keeps that build from
 * ever reaching a deploy.
 */
/** @returns {import('astro').AstroIntegration} */
function requireClerkPublishableKey() {
  return {
    name: 'fewya:require-clerk-publishable-key',
    hooks: {
      'astro:build:start': ({ logger }) => {
        const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
        const problem = checkClerkPublishableKey(
          process.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.PUBLIC_CLERK_PUBLISHABLE_KEY,
        );
        if (!problem) return;
        if (problem.level === 'warning') logger.warn(problem.message);
        else throw new Error(problem.message);
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://fewya.com',
  output: 'server',
  adapter: cloudflare(),
  devToolbar: { enabled: false },
  env: {
    schema: {
      // Runtime-only deployment URL; it is never bundled into browser code.
      // Every read and write goes through it, so a Worker without it can only
      // serve static pages.
      CONVEX_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Shared secret used only by the verified Stripe webhook to authorize
      // server-to-server payment mutations in Convex.
      CONVEX_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      CLERK_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      CLERK_JWT_ISSUER_DOMAIN: envField.string({ context: 'server', access: 'public', optional: true }),
      CLERK_JWT_TEMPLATE: envField.string({ context: 'server', access: 'secret', optional: true }),
      APP_MODE: envField.enum({
        context: 'server',
        access: 'secret',
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
      APP_BASE_URL: envField.string({ context: 'server', access: 'secret', default: 'https://fewya.com', optional: true }),
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_FROM: envField.string({ context: 'server', access: 'public', default: 'Fewya <no-reply@fewya.com>', optional: true }),
      // access:'secret' (runtime lookup) on purpose: 'public' vars are inlined at build
      // time from the BUILD machine's env, so CI builds (no .env) would bake in null.
      // The value itself is not sensitive; it's served to browsers via an endpoint.
      VAPID_PUBLIC_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_SUBJECT: envField.string({ context: 'server', access: 'public', default: 'mailto:no-reply@fewya.com', optional: true }),
    }
  },
  // PWA must be an Astro integration (not a raw vite plugin): with the plugin in
  // vite.plugins, Astro's multi-phase build never runs the generateSW step and
  // the built site ships without sw.js, breaking offline caching and web push.
  integrations: [
    // The integration must always be installed because the Astro components
    // resolve its virtual config module at build time. Runtime auth remains
    // conditional on the publishable key in middleware and pages.
    clerk({
      appearance: clerkAppearance,
      signInUrl: '/login',
      signUpUrl: '/sign-up',
      signInFallbackRedirectUrl: '/me',
      signUpFallbackRedirectUrl: '/me',
    }),
    requireClerkPublishableKey(),
    AstroPWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.webmanifest',
      devOptions: {
        enabled: true,
        suppressWarnings: true,
      },
      manifest: {
        id: '/',
        name: 'Fewya Marketplace',
        short_name: 'Fewya',
        description: 'Marketplace moderno para pequeños negocios',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F7FF',
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
        // Activate updates and control open pages without waiting for a reload.
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null,
        // Push + notificationclick handlers live in a static script that Workbox
        // imports into the generated service worker (keeps generateSW strategy).
        importScripts: ['/sw-push.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            // SSR pages reflect the current session, including public pages'
            // account controls. Never replay HTML from an earlier session.
            handler: 'NetworkOnly',
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
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
