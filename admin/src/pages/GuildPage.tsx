import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { addFeed, getChannels, getFeeds } from '../api';
import { AddFeedModal, FeedRow } from '../components/FeedUI';
import type { Channel, Feed } from '../types';

export function GuildPage() {
    const { guildId } = useParams<{ guildId: string }>();
    const location = useLocation();
    const guildName = (location.state as { guildName?: string } | null)?.guildName;
    const [feeds, setFeeds] = useState<Feed[]>([]);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [channelFilter, setChannelFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAdd, setShowAdd] = useState(false);

    const load = useCallback(async () => {
        if (!guildId) return;
        setLoading(true);
        setError('');
        try {
            const [channelData, feedData] = await Promise.all([
                getChannels(guildId),
                getFeeds(guildId, channelFilter || undefined),
            ]);
            setChannels(channelData.channels);
            setFeeds(feedData.feeds ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [guildId, channelFilter]);

    useEffect(() => {
        load();
    }, [load]);

    const channelMap = useMemo(
        () => new Map(channels.map(ch => [ch.id, ch.name])),
        [channels]
    );

    if (!guildId) return null;

    return (
        <>
            <Link to="/guilds" className="back-link">
                ← All servers
            </Link>
            <div className="section-header">
                <div>
                    <h2>{guildName ? guildName : 'Feeds'}</h2>
                    {!loading && !error && (
                        <p className="section-subtitle">
                            {feeds.length} feed{feeds.length === 1 ? '' : 's'}
                        </p>
                    )}
                </div>
                <div className="filters">
                    <select
                        className="select"
                        value={channelFilter}
                        onChange={e => setChannelFilter(e.target.value)}
                    >
                        <option value="">All channels</option>
                        {channels.map(ch => (
                            <option key={ch.id} value={ch.id}>
                                #{ch.name}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setShowAdd(true)}
                        disabled={channels.length === 0}
                    >
                        Add feed
                    </button>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}
            {loading ? (
                <div className="loading">Loading feeds…</div>
            ) : feeds.length === 0 ? (
                <div className="empty-state">
                    No feeds yet. Add one to start posting RSS updates to Discord.
                </div>
            ) : (
                <div className="feed-list">
                    {feeds.map(feed => (
                        <FeedRow
                            key={feed.id}
                            guildId={guildId}
                            feed={feed}
                            channelName={`#${channelMap.get(feed.channelId) ?? 'unknown'}`}
                            onChanged={load}
                        />
                    ))}
                </div>
            )}

            {showAdd && (
                <AddFeedModal
                    channels={channels}
                    onClose={() => setShowAdd(false)}
                    onSubmit={async data => {
                        await addFeed(guildId, data);
                        await load();
                    }}
                />
            )}
        </>
    );
}
