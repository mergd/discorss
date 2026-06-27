import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button } from 'baseui/button';
import { Select, type Value } from 'baseui/select';
import { addFeed, getChannels, getFeeds } from '../api';
import { AddFeedModal, FeedRow } from '../components/FeedUI';
import { EmptyState, ErrorBanner, Loading, SectionHeader } from '../components/ui';
import type { Channel, Feed } from '../types';
import { css } from 'styled-system/css';
import { flex } from 'styled-system/patterns';

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

    const filterOptions = useMemo(
        () => channels.map(ch => ({ id: ch.id, label: `#${ch.name}` })),
        [channels]
    );

    const filterValue: Value = channelFilter
        ? filterOptions.filter(o => o.id === channelFilter)
        : [];

    if (!guildId) return null;

    return (
        <>
            <Link
                to="/guilds"
                className={css({
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '1',
                    mb: '4',
                    fontSize: '0.9rem',
                    color: 'textMuted',
                    _hover: { color: 'text' },
                })}
            >
                ← All servers
            </Link>

            <SectionHeader
                title={guildName ? guildName : 'Feeds'}
                subtitle={
                    !loading && !error
                        ? `${feeds.length} feed${feeds.length === 1 ? '' : 's'}`
                        : undefined
                }
                actions={
                    <>
                        <div className={css({ minW: '200px' })}>
                            <Select
                                size="compact"
                                options={filterOptions}
                                value={filterValue}
                                placeholder="All channels"
                                onChange={({ value }) =>
                                    setChannelFilter(value.length ? String(value[0].id) : '')
                                }
                            />
                        </div>
                        <Button onClick={() => setShowAdd(true)} disabled={channels.length === 0}>
                            Add feed
                        </Button>
                    </>
                }
            />

            {error && <ErrorBanner>{error}</ErrorBanner>}
            {loading ? (
                <Loading>Loading feeds…</Loading>
            ) : feeds.length === 0 ? (
                <EmptyState>
                    No feeds yet. Add one to start posting RSS updates to Discord.
                </EmptyState>
            ) : (
                <div className={flex({ direction: 'column', gap: '2.5' })}>
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
