import { Link } from 'react-router-dom';

type LegalLayoutProps = {
    title: string;
    children: React.ReactNode;
};

export function LegalLayout({ title, children }: LegalLayoutProps) {
    return (
        <div className="legal-page">
            <header className="legal-header">
                <Link to="/" className="brand">
                    <div className="brand-mark">R</div>
                    <div>
                        <h1>Discorss</h1>
                        <p>Feed management</p>
                    </div>
                </Link>
            </header>
            <article className="legal-card">
                <h2>{title}</h2>
                <p className="legal-updated">Last updated: June 26, 2026</p>
                <div className="legal-body">{children}</div>
                <footer className="legal-footer">
                    <Link to="/">Back to login</Link>
                    <span>·</span>
                    <Link to="/privacy">Privacy</Link>
                    <span>·</span>
                    <Link to="/terms">Terms</Link>
                </footer>
            </article>
        </div>
    );
}
