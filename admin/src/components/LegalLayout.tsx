import { Link } from 'react-router-dom';
import { css } from 'styled-system/css';
import { flex } from 'styled-system/patterns';
import { Brand } from './Brand';

type LegalLayoutProps = {
    title: string;
    children: React.ReactNode;
};

export function LegalLayout({ title, children }: LegalLayoutProps) {
    return (
        <div className={css({ maxW: '720px', mx: 'auto', px: '6', pt: '8', pb: '16' })}>
            <div className={css({ mb: '8' })}>
                <Brand to="/" />
            </div>
            <article
                className={css({
                    bg: 'surface',
                    border: '1px solid token(colors.border)',
                    borderRadius: 'xl',
                    p: '8',
                    boxShadow: 'pop',
                })}
            >
                <h2
                    className={css({
                        m: 0,
                        mb: '1',
                        fontSize: '1.75rem',
                        fontWeight: 600,
                        letterSpacing: '-0.03em',
                    })}
                >
                    {title}
                </h2>
                <p className={css({ mt: 0, mb: '7', fontSize: '0.85rem', color: 'textMuted' })}>
                    Last updated: June 26, 2026
                </p>
                <div
                    className={css({
                        '& h3': {
                            mt: '6',
                            mb: '2',
                            fontSize: '1rem',
                            fontWeight: 600,
                        },
                        '& p, & ul': {
                            mt: 0,
                            mb: '4',
                            color: 'textMuted',
                            lineHeight: 1.65,
                            fontSize: '0.95rem',
                        },
                        '& ul': { pl: '5' },
                        '& li': { mb: '2' },
                        '& a': { color: 'accentText', _hover: { color: 'text' } },
                        '& strong': { color: 'text' },
                    })}
                >
                    {children}
                </div>
                <footer
                    className={flex({
                        align: 'center',
                        gap: '2',
                        mt: '8',
                        pt: '5',
                        borderTop: '1px solid token(colors.border)',
                        fontSize: '0.85rem',
                        color: 'textMuted',
                    })}
                >
                    <Link className={css({ _hover: { color: 'text' } })} to="/">
                        Back to login
                    </Link>
                    <span className={css({ color: 'border' })}>·</span>
                    <Link className={css({ _hover: { color: 'text' } })} to="/privacy">
                        Privacy
                    </Link>
                    <span className={css({ color: 'border' })}>·</span>
                    <Link className={css({ _hover: { color: 'text' } })} to="/terms">
                        Terms
                    </Link>
                </footer>
            </article>
        </div>
    );
}
