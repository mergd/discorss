import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getMe } from './api';
import { Layout } from './components/Layout';
import { GuildPage } from './pages/GuildPage';
import { GuildsPage } from './pages/GuildsPage';
import { LoginPage } from './pages/LoginPage';
import type { AuthUser } from './types';

export default function App() {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        getMe()
            .then(data => {
                if (data.authenticated && data.user) setUser(data.user);
            })
            .finally(() => setChecked(true));
    }, []);

    if (!checked) {
        return <div className="loading">Loading…</div>;
    }

    if (!user) {
        return (
            <Routes>
                <Route path="/" element={<LoginPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        );
    }

    return (
        <Routes>
            <Route element={<Layout user={user} />}>
                <Route path="/guilds" element={<GuildsPage />} />
                <Route path="/guilds/:guildId" element={<GuildPage />} />
                <Route path="/" element={<Navigate to="/guilds" replace />} />
                <Route path="*" element={<Navigate to="/guilds" replace />} />
            </Route>
        </Routes>
    );
}
