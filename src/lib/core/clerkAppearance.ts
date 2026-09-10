/**
 * Keep Clerk's hosted UI on the same design tokens as the application.
 * The values are CSS variables so the component follows the user's persisted
 * `data-theme` without requiring a client-side remount when the theme changes.
 */
export const clerkAppearance = {
    cssLayerName: 'clerk',
    variables: {
        colorBackground: 'var(--color-surface-val)',
        colorInput: 'var(--color-bg-val)',
        colorInputForeground: 'var(--color-text-primary-val)',
        colorForeground: 'var(--color-text-primary-val)',
        colorMutedForeground: 'var(--color-text-secondary-val)',
        colorNeutral: 'var(--color-text-primary-val)',
        colorBorder: 'var(--color-border-light-val)',
        colorPrimary: 'var(--color-accent-val)',
        colorPrimaryForeground: '#ffffff',
        colorDanger: '#f87171',
    },
    elements: {
        card: 'border border-border-light shadow-xl',
        socialButtonsBlockButton: 'border border-border-light',
        formFieldInput: 'border-border-light',
        formButtonPrimary: 'font-semibold',
    },
};
