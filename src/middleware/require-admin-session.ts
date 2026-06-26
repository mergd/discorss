import { NextFunction, Request, Response } from 'express';
import { AdminSession, parseSessionCookie } from '../services/admin-session.js';
import { env } from '../utils/env.js';

declare global {
    namespace Express {
        interface Request {
            adminSession?: AdminSession;
        }
    }
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
    const session = parseSessionCookie(req.headers.cookie, env.ADMIN_SESSION_SECRET);
    if (!session) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    req.adminSession = session;
    next();
}
