import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from 'baseui/avatar';
import { getGuilds } from '../api';
import type { Guild } from '../types';
import { css } from 'styled-system/css';
import { grid } from 'styled-system/patterns';
import { avatarOverrides, EmptyState, ErrorBanner, Loading, SectionHeader } from '../components/ui';

export function GuildsPage() {
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        getGuilds()
            .then(data => setGuilds(data.guilds))
            .catch(err => setError(err instanceof Error ? err.message : 'Failed to load guilds'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <Loading>Loading servers…</Loading>;
    if (error) return <ErrorBanner>{error}</ErrorBanner>;

    return (
        <>
            <SectionHeader title="Your servers" />
            {guilds.length === 0 ? (
                <EmptyState>
                    No servers found where you have Manage Server permission and Discorss is
                    installed.
                </EmptyState>
            ) : (
                <div
                    className={grid({
                        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                        gap: '3',
                    })}
                >
                    {guilds.map((guild, i) => (
                        <Link
                            key={guild.id}
                            to={`/guilds/${guild.id}`}
                            state={{ guildName: guild.name }}
                            style={{ animationDelay: `${i * 40}ms` }}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3.5',
                                p: '3.5',
                                bg: 'surface',
                                border: '1px solid token(colors.border)',
                                borderRadius: 'md',
                                animation: 'fadeUp 0.3s ease both',
                                transition: 'border-color 0.15s, box-shadow 0.2s, transform 0.15s',
                                _hover: {
                                    borderColor: 'rgba(88, 101, 242, 0.4)',
                                    boxShadow: 'cardHover',
                                    transform: 'translateY(-2px)',
                                },
                            })}
                        >
                            <Avatar
                                name={guild.name}
                                size="44px"
                                src={guild.iconUrl ?? undefined}
                                overrides={avatarOverrides('14px')}
                            />
                            <h3 className={css({ m: 0, fontSize: '0.95rem', fontWeight: 600 })}>
                                {guild.name}
                            </h3>
                        </Link>
                    ))}
                </div>
            )}
        </>
    );
}
