import { Spinner } from 'baseui/spinner';
import { Notification, KIND as NOTIFICATION_KIND } from 'baseui/notification';
import { css } from 'styled-system/css';
import { flex, hstack } from 'styled-system/patterns';

// Cohesive dark/blurple fallback for BaseUI Avatar initials (vs the default bright gray).
export function avatarOverrides(radius = '50%') {
    return {
        Root: {
            style: {
                borderTopLeftRadius: radius,
                borderTopRightRadius: radius,
                borderBottomLeftRadius: radius,
                borderBottomRightRadius: radius,
                backgroundColor: '#222a3c',
                backgroundImage: 'linear-gradient(135deg, #2b3350, #1b2030)',
            },
        },
        Initials: { style: { color: '#c3c9ff', fontWeight: 600 } },
    } as const;
}

export function Loading({ children }: { children?: React.ReactNode }) {
    return (
        <div
            className={hstack({
                gap: '3',
                justify: 'center',
                py: '12',
                color: 'textMuted',
            })}
        >
            <Spinner $size="24px" $borderWidth="3px" />
            <span>{children ?? 'Loading…'}</span>
        </div>
    );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
    return (
        <div className={css({ mb: '4' })}>
            <Notification
                kind={NOTIFICATION_KIND.negative}
                overrides={{ Body: { style: { width: 'auto', marginLeft: 0, marginRight: 0 } } }}
            >
                {children}
            </Notification>
        </div>
    );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
    return (
        <div
            className={css({
                textAlign: 'center',
                py: '12',
                px: '6',
                color: 'textMuted',
                border: '1px dashed token(colors.border)',
                borderRadius: 'md',
            })}
        >
            {children}
        </div>
    );
}

type SectionHeaderProps = {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
};

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
    return (
        <div
            className={flex({
                align: 'center',
                justify: 'space-between',
                gap: '4',
                mb: '4',
                wrap: 'wrap',
            })}
        >
            <div>
                <h2
                    className={css({
                        m: 0,
                        fontSize: '1.35rem',
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                    })}
                >
                    {title}
                </h2>
                {subtitle && (
                    <p className={css({ mt: '1', mb: 0, fontSize: '0.85rem', color: 'textMuted' })}>
                        {subtitle}
                    </p>
                )}
            </div>
            {actions && <div className={flex({ gap: '3', wrap: 'wrap' })}>{actions}</div>}
        </div>
    );
}
