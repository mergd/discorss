import { useNavigate } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { Avatar } from 'baseui/avatar';
import { Button, KIND, SIZE } from 'baseui/button';
import { css } from 'styled-system/css';
import { flex } from 'styled-system/patterns';
import type { AuthUser } from '../types';
import { logout } from '../api';
import { Brand } from './Brand';
import { avatarOverrides } from './ui';

type LayoutProps = {
    user: AuthUser;
};

export function Layout({ user }: LayoutProps) {
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/');
    }

    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : undefined;

    return (
        <div>
            <header
                className={css({
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    backdropFilter: 'blur(12px)',
                    backgroundColor: 'rgba(13, 15, 21, 0.72)',
                    borderBottom: '1px solid token(colors.border)',
                })}
            >
                <div
                    className={flex({
                        align: 'center',
                        justify: 'space-between',
                        gap: '4',
                        maxW: '1100px',
                        mx: 'auto',
                        px: '6',
                        py: '4',
                    })}
                >
                    <Brand />
                    <div className={flex({ align: 'center', gap: '3' })}>
                        <div
                            className={flex({
                                align: 'center',
                                gap: '2',
                                pl: '1',
                                pr: '3',
                                py: '1',
                                bg: 'surface',
                                border: '1px solid token(colors.border)',
                                borderRadius: 'pill',
                            })}
                        >
                            <Avatar
                                name={user.username}
                                size="28px"
                                src={avatarUrl}
                                overrides={avatarOverrides('50%')}
                            />
                            <span className={css({ fontSize: '0.9rem', fontWeight: 500 })}>
                                {user.username}
                            </span>
                        </div>
                        <Button kind={KIND.secondary} size={SIZE.compact} onClick={handleLogout}>
                            Log out
                        </Button>
                    </div>
                </div>
            </header>
            <main
                className={css({
                    maxW: '1080px',
                    mx: 'auto',
                    px: '6',
                    pt: '6',
                    pb: '16',
                })}
            >
                <Outlet />
            </main>
        </div>
    );
}
