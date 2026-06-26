import { LegalLayout } from '../components/LegalLayout';

export function TermsPage() {
    return (
        <LegalLayout title="Terms of Service">
            <p>
                By using Discorss (the Discord bot and admin panel), you agree to these terms. If
                you do not agree, do not use the service.
            </p>

            <h3>Service description</h3>
            <p>
                Discorss polls RSS and YouTube feeds and posts new items to Discord channels you
                configure. An optional web admin panel lets authorized server managers add and
                manage feeds. The service is provided &quot;as is&quot; without guaranteed uptime.
            </p>

            <h3>Eligibility</h3>
            <p>
                You must have permission to manage the Discord servers and channels where you add
                feeds. You must comply with Discord&apos;s Terms of Service and the terms of any
                feeds or sites you subscribe to.
            </p>

            <h3>Acceptable use</h3>
            <ul>
                <li>Do not use Discorss to spam, harass, or violate others&apos; rights.</li>
                <li>Do not attempt to abuse, overload, or reverse-engineer the service.</li>
                <li>Do not add feeds you do not have the right to republish or summarize.</li>
                <li>Respect rate limits and copyright of content sources.</li>
            </ul>

            <h3>AI summarization</h3>
            <p>
                When enabled, feed content may be sent to third-party AI providers for
                summarization. Summaries may be inaccurate. You are responsible for reviewing what
                gets posted to your server.
            </p>

            <h3>Availability &amp; changes</h3>
            <p>
                We may modify, suspend, or discontinue features at any time. We are not liable for
                missed feed items, delayed posts, or data loss. Back up important configuration if
                needed.
            </p>

            <h3>Limitation of liability</h3>
            <p>
                To the fullest extent permitted by law, Discorss and its operators are not liable
                for indirect, incidental, or consequential damages arising from use of the service.
            </p>

            <h3>Termination</h3>
            <p>
                We may restrict access if these terms are violated. You may stop using the service
                at any time by removing the bot from your server.
            </p>

            <h3>Contact</h3>
            <p>
                Questions about these terms:{' '}
                <a href="https://github.com/mergd/discorss" target="_blank" rel="noreferrer">
                    github.com/mergd/discorss
                </a>
                .
            </p>
        </LegalLayout>
    );
}
