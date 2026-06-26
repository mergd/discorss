import { useState } from 'react';
import type { Channel, Feed } from '../types';
import { deleteFeed, updateFeed } from '../api';

type FeedRowProps = {
    guildId: string;
    feed: Feed;
    channelName: string;
    onChanged: () => void;
};

export function FeedRow({ guildId, feed, channelName, onChanged }: FeedRowProps) {
    const [busy, setBusy] = useState(false);

    async function toggle(field: 'summarize' | 'disabled' | 'useArchiveLinks') {
        setBusy(true);
        try {
            await updateFeed(guildId, feed.id, {
                channelId: feed.channelId,
                [field]: !feed[field],
            });
            onChanged();
        } finally {
            setBusy(false);
        }
    }

    async function handleDelete() {
        if (!confirm(`Remove feed "${feed.nickname || feed.url}"?`)) return;
        setBusy(true);
        try {
            await deleteFeed(guildId, feed.id, feed.channelId);
            onChanged();
        } finally {
            setBusy(false);
        }
    }

    return (
        <article className={`feed-card${feed.disabled ? ' disabled' : ''}`}>
            <div className="feed-header">
                <div>
                    <h3 className="feed-title">{feed.nickname || 'Untitled feed'}</h3>
                    <p className="feed-url">{feed.url}</p>
                </div>
                <div className="badges">
                    <span className="badge">{channelName}</span>
                    {feed.summarize && <span className="badge ai">AI summary</span>}
                    {feed.useArchiveLinks && <span className="badge">Archive links</span>}
                    {feed.consecutiveFailures > 0 && (
                        <span className="badge warn">{feed.consecutiveFailures} failures</span>
                    )}
                    {feed.disabled && <span className="badge off">Disabled</span>}
                </div>
            </div>
            <div className="feed-actions">
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={feed.summarize}
                        disabled={busy}
                        onChange={() => toggle('summarize')}
                    />
                    Summarize
                </label>
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={feed.useArchiveLinks}
                        disabled={busy}
                        onChange={() => toggle('useArchiveLinks')}
                    />
                    Archive links
                </label>
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={!feed.disabled}
                        disabled={busy}
                        onChange={() => toggle('disabled')}
                    />
                    Enabled
                </label>
                <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={handleDelete}
                >
                    Remove
                </button>
            </div>
        </article>
    );
}

type AddFeedModalProps = {
    channels: Channel[];
    onClose: () => void;
    onSubmit: (data: {
        url: string;
        channelId: string;
        nickname?: string;
        summarize: boolean;
        useArchiveLinks: boolean;
    }) => Promise<void>;
};

export function AddFeedModal({ channels, onClose, onSubmit }: AddFeedModalProps) {
    const [url, setUrl] = useState('');
    const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
    const [nickname, setNickname] = useState('');
    const [summarize, setSummarize] = useState(false);
    const [useArchiveLinks, setUseArchiveLinks] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            await onSubmit({
                url: url.trim(),
                channelId,
                nickname: nickname.trim() || undefined,
                summarize,
                useArchiveLinks,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add feed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>Add RSS feed</h3>
                {error && <div className="error-banner">{error}</div>}
                <form className="form-grid" onSubmit={handleSubmit}>
                    <div className="form-field">
                        <label htmlFor="feed-url">Feed URL</label>
                        <input
                            id="feed-url"
                            className="input"
                            type="url"
                            placeholder="https://example.com/feed.xml"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-field">
                        <label htmlFor="feed-channel">Channel</label>
                        <select
                            id="feed-channel"
                            className="select"
                            value={channelId}
                            onChange={e => setChannelId(e.target.value)}
                            required
                        >
                            {channels.map(ch => (
                                <option key={ch.id} value={ch.id}>
                                    #{ch.name}
                                    {ch.type === 'announcement' ? ' (announcement)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-field">
                        <label htmlFor="feed-nickname">Nickname (optional)</label>
                        <input
                            id="feed-nickname"
                            className="input"
                            placeholder="Auto-detected from feed"
                            value={nickname}
                            onChange={e => setNickname(e.target.value)}
                        />
                    </div>
                    <div className="checkbox-row">
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={summarize}
                                onChange={e => setSummarize(e.target.checked)}
                            />
                            AI summarization
                        </label>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={useArchiveLinks}
                                onChange={e => setUseArchiveLinks(e.target.checked)}
                            />
                            Archive.is links
                        </label>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                            {busy ? 'Adding…' : 'Add feed'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
