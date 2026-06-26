import { useSearchParams } from 'react-router-dom';

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
        <div className="login-page">
            <div className="login-card">
                <div className="brand-mark" style={{ margin: '0 auto' }}>
                    R
                </div>
                <h2>Discorss Admin</h2>
                <p>Manage RSS feeds for your Discord servers. Sign in with a Discord account that has Manage Server permission.</p>
                {errorMessage && <div className="login-error">{errorMessage}</div>}
                <a href="/auth/discord" className="btn btn-primary" style={{ width: '100%' }}>
                    Continue with Discord
                </a>
                <p className="login-legal">
                    <a href="/terms">Terms</a>
                    <span> · </span>
                    <a href="/privacy">Privacy</a>
                </p>
            </div>
        </div>
    );
}
