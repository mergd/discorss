import { useState } from 'react';
import { Button, KIND as BUTTON_KIND, SIZE } from 'baseui/button';
import { Checkbox, STYLE_TYPE, LABEL_PLACEMENT } from 'baseui/checkbox';
import { Input } from 'baseui/input';
import {
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalButton,
    ROLE,
    SIZE as MODAL_SIZE,
} from 'baseui/modal';
import { FormControl } from 'baseui/form-control';
import { Select, type Value } from 'baseui/select';
import { Tag, KIND as TAG_KIND, HIERARCHY } from 'baseui/tag';
import { css } from 'styled-system/css';
import { flex, hstack } from 'styled-system/patterns';
import type { Channel, Feed } from '../types';
import { deleteFeed, updateFeed } from '../api';
import { ErrorBanner } from './ui';

const tagOverrides = {
    Root: { style: { marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 } },
} as const;

type FeedRowProps = {
    guildId: string;
    feed: Feed;
    channelName: string;
    onChanged: () => void;
};

export function FeedRow({ guildId, feed, channelName, onChanged }: FeedRowProps) {
    const [busy, setBusy] = useState(false);

    async function toggle(field: 'summarize' | 'disabled' | 'useArchiveLinks' | 'suppressLinkPreview') {
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

    const status: { color: string; title: string } = feed.disabled
        ? { color: '#ed4245', title: 'Disabled' }
        : feed.consecutiveFailures > 0
          ? { color: '#faa81a', title: `${feed.consecutiveFailures} recent failures` }
          : { color: '#3ba55d', title: 'Active' };

    return (
        <article
            style={{ opacity: feed.disabled ? 0.6 : 1 }}
            className={css({
                bg: 'surface',
                border: '1px solid token(colors.border)',
                borderRadius: 'md',
                p: '3.5',
                display: 'grid',
                gap: '2.5',
                animation: 'fadeUp 0.3s ease both',
                transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.2s, transform 0.15s',
                _hover: {
                    borderColor: 'rgba(88, 101, 242, 0.35)',
                    boxShadow: 'cardHover',
                    transform: 'translateY(-1px)',
                },
            })}
        >
            <div className={flex({ align: 'flex-start', justify: 'space-between', gap: '3' })}>
                <div className={flex({ align: 'flex-start', gap: '2.5', minW: 0 })}>
                    <span
                        title={status.title}
                        style={{
                            background: status.color,
                            boxShadow: `0 0 0 3px ${status.color}22`,
                        }}
                        className={css({
                            mt: '1.5',
                            w: '8px',
                            h: '8px',
                            flexShrink: 0,
                            borderRadius: 'pill',
                        })}
                    />
                    <div className={css({ minW: 0 })}>
                        <h3 className={css({ m: 0, fontSize: '0.95rem', fontWeight: 600 })}>
                            {feed.nickname || 'Untitled feed'}
                        </h3>
                        <a
                            href={feed.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={css({
                                display: 'block',
                                mt: '0.5',
                                fontSize: '0.78rem',
                                color: 'textSubtle',
                                wordBreak: 'break-all',
                                transition: 'color 0.15s',
                                _hover: { color: 'accentText' },
                            })}
                        >
                            {feed.url}
                        </a>
                    </div>
                </div>
                <div className={flex({ wrap: 'wrap', gap: '1.5', justify: 'flex-end' })}>
                    <Tag
                        closeable={false}
                        size="small"
                        kind={TAG_KIND.gray}
                        hierarchy={HIERARCHY.secondary}
                        overrides={tagOverrides}
                    >
                        {channelName}
                    </Tag>
                    {feed.summarize && (
                        <Tag
                            closeable={false}
                            size="small"
                            kind={TAG_KIND.purple}
                            hierarchy={HIERARCHY.primary}
                            overrides={tagOverrides}
                        >
                            AI summary
                        </Tag>
                    )}
                    {feed.useArchiveLinks && (
                        <Tag
                            closeable={false}
                            size="small"
                            kind={TAG_KIND.gray}
                            hierarchy={HIERARCHY.secondary}
                            overrides={tagOverrides}
                        >
                            Archive links
                        </Tag>
                    )}
                    {feed.suppressLinkPreview && (
                        <Tag
                            closeable={false}
                            size="small"
                            kind={TAG_KIND.gray}
                            hierarchy={HIERARCHY.secondary}
                            overrides={tagOverrides}
                        >
                            No preview
                        </Tag>
                    )}
                    {feed.consecutiveFailures > 0 && (
                        <Tag
                            closeable={false}
                            size="small"
                            kind={TAG_KIND.orange}
                            hierarchy={HIERARCHY.primary}
                            overrides={tagOverrides}
                        >
                            {feed.consecutiveFailures} failures
                        </Tag>
                    )}
                </div>
            </div>

            <div
                className={flex({
                    wrap: 'wrap',
                    align: 'center',
                    gap: '4',
                    pt: '2.5',
                    borderTop: '1px solid token(colors.border)',
                })}
            >
                <ToggleSwitch
                    checked={feed.summarize}
                    disabled={busy}
                    onChange={() => toggle('summarize')}
                >
                    Summarize
                </ToggleSwitch>
                <ToggleSwitch
                    checked={feed.useArchiveLinks}
                    disabled={busy}
                    onChange={() => toggle('useArchiveLinks')}
                >
                    Archive
                </ToggleSwitch>
                <ToggleSwitch
                    checked={feed.suppressLinkPreview}
                    disabled={busy}
                    onChange={() => toggle('suppressLinkPreview')}
                >
                    Hide preview
                </ToggleSwitch>
                <ToggleSwitch
                    checked={!feed.disabled}
                    disabled={busy}
                    onChange={() => toggle('disabled')}
                >
                    Enabled
                </ToggleSwitch>
                <div className={css({ ml: 'auto' })}>
                    <Button
                        kind={BUTTON_KIND.tertiary}
                        size={SIZE.mini}
                        disabled={busy}
                        onClick={handleDelete}
                        overrides={{
                            BaseButton: {
                                style: ({ $theme }) => ({
                                    color: $theme.colors.negative,
                                    backgroundColor: 'transparent',
                                    ':hover': { backgroundColor: 'rgba(237, 66, 69, 0.14)' },
                                }),
                            },
                        }}
                    >
                        Remove
                    </Button>
                </div>
            </div>
        </article>
    );
}

function ToggleSwitch({
    checked,
    disabled,
    onChange,
    children,
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    children: React.ReactNode;
}) {
    return (
        <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            checkmarkType={STYLE_TYPE.toggle_round}
            labelPlacement={LABEL_PLACEMENT.right}
            overrides={{
                Root: { style: { alignItems: 'center' } },
                Label: { style: { fontSize: '0.82rem', paddingLeft: '7px' } },
                ToggleTrack: {
                    style: { width: '30px', height: '14px', marginTop: '3px', marginBottom: '3px' },
                },
                Toggle: { style: { width: '18px', height: '18px' } },
            }}
        >
            {children}
        </Checkbox>
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
        suppressLinkPreview: boolean;
    }) => Promise<void>;
};

export function AddFeedModal({ channels, onClose, onSubmit }: AddFeedModalProps) {
    const channelOptions = channels.map(ch => ({
        id: ch.id,
        label: `#${ch.name}${ch.type === 'announcement' ? ' (announcement)' : ''}`,
    }));

    const [url, setUrl] = useState('');
    const [channelValue, setChannelValue] = useState<Value>(
        channelOptions.length ? [channelOptions[0]] : []
    );
    const [nickname, setNickname] = useState('');
    const [summarize, setSummarize] = useState(false);
    const [useArchiveLinks, setUseArchiveLinks] = useState(false);
    const [suppressLinkPreview, setSuppressLinkPreview] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const channelId = channelValue.length ? String(channelValue[0].id) : '';
        if (!channelId) {
            setError('Pick a channel');
            return;
        }
        setError('');
        setBusy(true);
        try {
            await onSubmit({
                url: url.trim(),
                channelId,
                nickname: nickname.trim() || undefined,
                summarize,
                useArchiveLinks,
                suppressLinkPreview,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add feed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            isOpen
            onClose={onClose}
            role={ROLE.dialog}
            size={MODAL_SIZE.default}
            overrides={{
                Dialog: {
                    style: {
                        backgroundColor: '#161a24',
                        borderTopLeftRadius: '16px',
                        borderTopRightRadius: '16px',
                        borderBottomLeftRadius: '16px',
                        borderBottomRightRadius: '16px',
                    },
                },
            }}
        >
            <form onSubmit={handleSubmit}>
                <ModalHeader>Add RSS feed</ModalHeader>
                <ModalBody>
                    {error && <ErrorBanner>{error}</ErrorBanner>}
                    <FormControl label="Feed URL">
                        <Input
                            type="url"
                            placeholder="https://example.com/feed.xml"
                            value={url}
                            onChange={e => setUrl(e.currentTarget.value)}
                            required
                            clearOnEscape
                        />
                    </FormControl>
                    <FormControl label="Channel">
                        <Select
                            options={channelOptions}
                            value={channelValue}
                            placeholder="Select a channel"
                            clearable={false}
                            onChange={({ value }) => setChannelValue(value)}
                        />
                    </FormControl>
                    <FormControl label="Nickname (optional)">
                        <Input
                            placeholder="Auto-detected from feed"
                            value={nickname}
                            onChange={e => setNickname(e.currentTarget.value)}
                        />
                    </FormControl>
                    <div className={hstack({ gap: '6', flexWrap: 'wrap', mt: '1' })}>
                        <Checkbox
                            checked={summarize}
                            onChange={e => setSummarize(e.currentTarget.checked)}
                            checkmarkType={STYLE_TYPE.toggle_round}
                            labelPlacement={LABEL_PLACEMENT.right}
                        >
                            AI summarization
                        </Checkbox>
                        <Checkbox
                            checked={useArchiveLinks}
                            onChange={e => setUseArchiveLinks(e.currentTarget.checked)}
                            checkmarkType={STYLE_TYPE.toggle_round}
                            labelPlacement={LABEL_PLACEMENT.right}
                        >
                            Archive.is links
                        </Checkbox>
                        <Checkbox
                            checked={suppressLinkPreview}
                            onChange={e => setSuppressLinkPreview(e.currentTarget.checked)}
                            checkmarkType={STYLE_TYPE.toggle_round}
                            labelPlacement={LABEL_PLACEMENT.right}
                        >
                            Hide link preview
                        </Checkbox>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <ModalButton type="button" kind={BUTTON_KIND.tertiary} onClick={onClose}>
                        Cancel
                    </ModalButton>
                    <ModalButton type="submit" isLoading={busy}>
                        Add feed
                    </ModalButton>
                </ModalFooter>
            </form>
        </Modal>
    );
}
