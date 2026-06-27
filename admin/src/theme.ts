import { createDarkTheme, type Theme } from 'baseui';

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif";

const theme: Theme = createDarkTheme({
    colors: {
        // Surfaces
        backgroundPrimary: '#0d0f15',
        backgroundSecondary: '#161a24',
        backgroundTertiary: '#1c2230',

        // Inputs
        inputFill: '#161a24',
        inputFillActive: '#1c2230',
        inputBorderError: '#ed4245',

        // Buttons
        buttonPrimaryFill: '#5865f2',
        buttonPrimaryHover: '#4752c4',
        buttonPrimaryActive: '#3a44a8',
        buttonSecondaryFill: 'rgba(255, 255, 255, 0.06)',
        buttonSecondaryHover: '#1c2230',
        buttonSecondaryText: '#f2f3f5',
        buttonTertiaryHover: '#1c2230',

        // Text
        contentPrimary: '#f2f3f5',
        contentSecondary: '#9ba3af',
        contentTertiary: '#6b7280',

        // Borders
        borderOpaque: 'rgba(255, 255, 255, 0.08)',
        borderSelected: '#5865f2',

        accent: '#5865f2',
        negative: '#ed4245',
        positive: '#3ba55d',
        warning: '#faa81a',
    },
    borders: {
        buttonBorderRadius: '10px',
        inputBorderRadius: '10px',
        popoverBorderRadius: '14px',
        surfaceBorderRadius: '14px',
        tagBorderRadius: '8px',
    },
});

// Apply the brand font across every BaseUI typography variant.
for (const value of Object.values(theme.typography)) {
    if (value && typeof value === 'object' && 'fontFamily' in value) {
        (value as { fontFamily: string }).fontFamily = FONT;
    }
}

export { theme };
