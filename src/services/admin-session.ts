import { createHmac, timingSafeEqual } from 'node:crypto';

export type AdminSession = {
    userId: string;
    username: string;
    avatar: string | null;
    accessToken: string;
    expiresAt: number;
};

const COOKIE_NAME = 'discorss_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionCookie(session: AdminSession, secret: string): string {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = sign(payload, secret);
    const value = `${payload}.${signature}`;
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);

    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`;
}

export function clearSessionCookie(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string | undefined, secret: string): AdminSession | null {
    if (!cookieHeader) return null;

    const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${COOKIE_NAME}=`));

    if (!match) return null;

    const value = match.slice(COOKIE_NAME.length + 1);
    const [payload, signature] = value.split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload, secret);
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
    }

    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminSession;
        if (!session.userId || !session.accessToken || !session.expiresAt) return null;
        if (Date.now() > session.expiresAt) return null;
        return session;
    } catch {
        return null;
    }
}

export function buildSession(
    user: { id: string; username: string; avatar: string | null },
    accessToken: string
): AdminSession {
    return {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        accessToken,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
}
