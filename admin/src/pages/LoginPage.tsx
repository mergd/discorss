import { useSearchParams } from 'react-router-dom';
import { Notification, KIND as NOTIFICATION_KIND } from 'baseui/notification';
import { css } from 'styled-system/css';
import { center, flex, vstack } from 'styled-system/patterns';
import { brandMark } from '../components/Brand';

export function LoginPage() {
    const [params] = useSearchParams();
    const error = params.get('error');

    const errorMessage =
        error === 'oauth_denied'
            ? 'Discord authorization was cancelled.'
            : error === 'oauth_failed'
              ? 'Sign-in failed. Check OAuth settings and try again.'
              : error === 'oauth_not_configured'
                ? 'OAuth is not configured on the server. Add DISCORD_CLIENT_SECRET to Railway (Discord Developer Portal → OAuth2 → Client Secret).'
                : null;

    return (
        <div className={center({ minH: '100vh', p: '6' })}>
            <div
                className={vstack({
                    gap: '0',
                    w: 'min(420px, 100%)',
                    bg: 'surface',
                    border: '1px solid token(colors.border)',
                    borderRadius: 'xl',
                    p: '10',
                    boxShadow: 'pop',
                    textAlign: 'center',
                })}
            >
                <div className={brandMark} style={{ width: 52, height: 52, fontSize: '1.4rem' }}>
                    R
                </div>
                <h2
                    className={css({
                        mt: '5',
                        mb: '2',
                        fontSize: '1.5rem',
                        fontWeight: 600,
                        letterSpacing: '-0.03em',
                    })}
                >
                    Discorss Admin
                </h2>
                <p className={css({ m: 0, color: 'textMuted', lineHeight: 1.5 })}>
                    Manage RSS feeds for your Discord servers. Sign in with a Discord account that
                    has Manage Server permission.
                </p>

                {errorMessage && (
                    <div className={css({ w: '100%', mt: '5' })}>
                        <Notification
                            kind={NOTIFICATION_KIND.negative}
                            overrides={{ Body: { style: { width: 'auto', marginLeft: 0, marginRight: 0 } } }}
                        >
                            {errorMessage}
                        </Notification>
                    </div>
                )}

                <a
                    href="/auth/discord"
                    className={flex({
                        align: 'center',
                        justify: 'center',
                        gap: '2',
                        w: '100%',
                        mt: '7',
                        h: '48px',
                        bg: 'accent',
                        color: 'white',
                        fontWeight: 600,
                        borderRadius: 'sm',
                        boxShadow: 'glow',
                        transition: 'background 0.15s, transform 0.1s',
                        _hover: { bg: 'accentHover' },
                        _active: { transform: 'scale(0.99)' },
                    })}
                >
                    <DiscordIcon />
                    Continue with Discord
                </a>

                <p className={css({ mt: '6', fontSize: '0.82rem', color: 'textMuted' })}>
                    <a className={css({ _hover: { color: 'text' } })} href="/terms">
                        Terms
                    </a>
                    <span> · </span>
                    <a className={css({ _hover: { color: 'text' } })} href="/privacy">
                        Privacy
                    </a>
                </p>
            </div>
        </div>
    );
}

function DiscordIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3a13.9 13.9 0 0 0-.617 1.27 18.27 18.27 0 0 0-5.535 0A13.9 13.9 0 0 0 9.116 3a19.74 19.74 0 0 0-4.435 1.37C1.88 8.55 1.12 12.62 1.5 16.63a19.92 19.92 0 0 0 6.073 3.08c.49-.67.927-1.38 1.302-2.13-.714-.27-1.398-.6-2.045-.99.171-.126.34-.257.5-.39a14.23 14.23 0 0 0 12.18 0c.163.14.332.27.5.39-.648.39-1.333.72-2.047.99.375.75.81 1.46 1.3 2.13a19.86 19.86 0 0 0 6.075-3.08c.45-4.65-.76-8.68-3.19-12.26ZM8.52 14.16c-1.18 0-2.156-1.08-2.156-2.41 0-1.33.955-2.42 2.156-2.42 1.21 0 2.176 1.1 2.156 2.42 0 1.33-.955 2.41-2.156 2.41Zm6.96 0c-1.18 0-2.156-1.08-2.156-2.41 0-1.33.955-2.42 2.156-2.42 1.21 0 2.176 1.1 2.156 2.42 0 1.33-.945 2.41-2.156 2.41Z" />
        </svg>
    );
}
