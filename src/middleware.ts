import { defineMiddleware } from 'astro:middleware';
import { exchangeAuthCodeForSession } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
    if (context.request.method !== 'GET' || context.url.pathname === '/api/auth/callback') {
        return next();
    }

    const redirectTo = await exchangeAuthCodeForSession(context.cookies, context.request, context.url);

    if (redirectTo) {
        return context.redirect(redirectTo);
    }

    return next();
});