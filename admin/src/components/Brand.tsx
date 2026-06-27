import { Link } from 'react-router-dom';
import { css } from 'styled-system/css';
import { flex } from 'styled-system/patterns';

export const brandMark = css({
    width: '40px',
    height: '40px',
    borderRadius: 'md',
    background: 'linear-gradient(135deg, #5865f2, #7289da)',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: '1.1rem',
    color: 'white',
    boxShadow: 'glow',
    flexShrink: 0,
});

type BrandProps = {
    to?: string;
    tagline?: string;
};

export function Brand({ to = '/guilds', tagline = 'Feed management' }: BrandProps) {
    return (
        <Link to={to} className={flex({ align: 'center', gap: '3' })}>
            <div className={brandMark}>R</div>
            <div>
                <h1
                    className={css({
                        margin: 0,
                        fontSize: '1.2rem',
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                    })}
                >
                    Discorss
                </h1>
                <p className={css({ margin: 0, fontSize: '0.82rem', color: 'textMuted' })}>
                    {tagline}
                </p>
            </div>
        </Link>
    );
}
