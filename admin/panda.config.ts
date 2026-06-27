import { defineConfig } from '@pandacss/dev';

export default defineConfig({
    preflight: true,
    include: ['./src/**/*.{ts,tsx,js,jsx}'],
    exclude: [],
    jsxFramework: 'react',
    outdir: 'styled-system',
    theme: {
        extend: {
            tokens: {
                colors: {
                    bg: { value: '#0d0f15' },
                    surface: { value: '#161a24' },
                    surfaceHover: { value: '#1c2230' },
                    surfaceMuted: { value: 'rgba(255, 255, 255, 0.04)' },
                    border: { value: 'rgba(255, 255, 255, 0.08)' },
                    borderStrong: { value: 'rgba(255, 255, 255, 0.14)' },
                    text: { value: '#f2f3f5' },
                    textMuted: { value: '#9ba3af' },
                    textSubtle: { value: '#6b7280' },
                    accent: { value: '#5865f2' },
                    accentHover: { value: '#4752c4' },
                    accentSoft: { value: 'rgba(88, 101, 242, 0.16)' },
                    accentText: { value: '#a5aeff' },
                    success: { value: '#3ba55d' },
                    danger: { value: '#ed4245' },
                    dangerText: { value: '#ff8a8c' },
                    warning: { value: '#faa81a' },
                },
                radii: {
                    sm: { value: '8px' },
                    md: { value: '12px' },
                    lg: { value: '16px' },
                    xl: { value: '20px' },
                    pill: { value: '999px' },
                },
                shadows: {
                    card: { value: '0 1px 2px rgba(0, 0, 0, 0.3)' },
                    cardHover: {
                        value: '0 8px 28px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(88, 101, 242, 0.25)',
                    },
                    pop: { value: '0 16px 48px rgba(0, 0, 0, 0.45)' },
                    glow: { value: '0 8px 24px rgba(88, 101, 242, 0.35)' },
                },
                fonts: {
                    sans: {
                        value: "'DM Sans', system-ui, -apple-system, sans-serif",
                    },
                },
            },
            keyframes: {
                fadeUp: {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                popIn: {
                    '0%': { opacity: '0', transform: 'scale(0.97)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
            },
        },
    },
    globalCss: {
        'html, body, #root': {
            minHeight: '100vh',
        },
        body: {
            margin: 0,
            fontFamily: 'sans',
            color: 'text',
            backgroundColor: 'bg',
            backgroundImage:
                'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(88, 101, 242, 0.18), transparent)',
            backgroundRepeat: 'no-repeat',
            WebkitFontSmoothing: 'antialiased',
            textRendering: 'optimizeLegibility',
        },
        a: { color: 'inherit', textDecoration: 'none' },
    },
});
