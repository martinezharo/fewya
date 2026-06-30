/// <reference types="astro/client" />

declare global {
    namespace App {
        interface Locals {
            locale: 'es' | 'en';
            t: import('./lib/core/i18n').Strings;
        }
    }
}

declare module 'my-canvas-confetti' {
    export { default } from 'canvas-confetti';
    export * from 'canvas-confetti';
}

export {};
