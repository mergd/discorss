import { Link, Outlet, useNavigate } from 'react-router-dom';
import type { AuthUser } from './types';
import { logout } from '../api';

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
        : null;

    return (
        <div className="app-shell">
            <header className="topbar">
                <Link to="/guilds" className="brand">
                    <div className="brand-mark">R</div>
                    <div>
                        <h1>Discorss</h1>
                        <p>Feed management</p>
                    </div>
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="user-chip">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" />
                        ) : (
                            <div
                                className="guild-placeholder"
                                style={{ width: 28, height: 28, borderRadius: '50%' }}
                            >
                                {user.username[0]?.toUpperCase()}
                            </div>
                        )}
                        <span>{user.username}</span>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                        Log out
                    </button>
                </div>
            </header>
            <Outlet />
        </div>
    );
}
