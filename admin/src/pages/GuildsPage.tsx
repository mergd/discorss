import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGuilds } from '../api';
import type { Guild } from '../types';

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

    if (loading) return <div className="loading">Loading servers…</div>;
    if (error) return <div className="error-banner">{error}</div>;

    return (
        <>
            <div className="section-header">
                <h2>Your servers</h2>
            </div>
            {guilds.length === 0 ? (
                <div className="empty-state">
                    No servers found where you have Manage Server permission and Discorss is installed.
                </div>
            ) : (
                <div className="guild-grid">
                    {guilds.map(guild => (
                        <Link
                            key={guild.id}
                            to={`/guilds/${guild.id}`}
                            state={{ guildName: guild.name }}
                            className="guild-card"
                        >
                            {guild.iconUrl ? (
                                <img src={guild.iconUrl} alt="" />
                            ) : (
                                <div className="guild-placeholder">
                                    {guild.name[0]?.toUpperCase()}
                                </div>
                            )}
                            <h3>{guild.name}</h3>
                        </Link>
                    ))}
                </div>
            )}
        </>
    );
}
