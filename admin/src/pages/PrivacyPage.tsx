import { LegalLayout } from '../components/LegalLayout';

export function PrivacyPage() {
    return (
        <LegalLayout title="Privacy Policy">
            <p>
                Discorss (&quot;we&quot;, &quot;us&quot;) operates a Discord bot and optional web
                admin panel that lets server administrators manage RSS and YouTube feeds.
            </p>

            <h3>What we collect</h3>
            <ul>
                <li>
                    <strong>Discord account data</strong> when you sign in to the admin panel:
                    user ID, username, avatar, and the list of servers you belong to (via Discord
                    OAuth). We use this only to verify you have permission to manage feeds.
                </li>
                <li>
                    <strong>Server configuration</strong> you create: feed URLs, channel IDs,
                    guild IDs, nicknames, and related settings stored in our database.
                </li>
                <li>
                    <strong>Operational logs</strong> such as errors, feed poll results, and basic
                    usage analytics (e.g. PostHog) to keep the service running and improve
                    reliability.
                </li>
            </ul>

            <h3>What we do not collect</h3>
            <ul>
                <li>We do not read Discord message content beyond what the bot posts.</li>
                <li>We do not sell your personal data.</li>
                <li>We do not use admin login data for advertising.</li>
            </ul>

            <h3>How we use data</h3>
            <p>
                Data is used solely to provide feed polling, Discord posting, AI summarization
                (when enabled), and admin panel access. OAuth access tokens are stored in signed
                session cookies and expire after seven days.
            </p>

            <h3>Third parties</h3>
            <ul>
                <li>
                    <strong>Discord</strong> — authentication and bot API (
                    <a href="https://discord.com/privacy" target="_blank" rel="noreferrer">
                        Discord Privacy Policy
                    </a>
                    )
                </li>
                <li>
                    <strong>Hosting &amp; database</strong> — Railway, PostgreSQL
                </li>
                <li>
                    <strong>AI summarization</strong> — OpenRouter / OpenAI when summarization is
                    enabled on a feed (article text may be sent for summarization)
                </li>
            </ul>

            <h3>Retention &amp; deletion</h3>
            <p>
                Feed configuration persists until removed by a server admin or when the bot is
                removed from a server. Contact us to request deletion of data associated with your
                account.
            </p>

            <h3>Contact</h3>
            <p>
                Questions about this policy: open an issue on{' '}
                <a href="https://github.com/mergd/discorss" target="_blank" rel="noreferrer">
                    github.com/mergd/discorss
                </a>
                .
            </p>
        </LegalLayout>
    );
}
