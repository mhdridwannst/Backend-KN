import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../common/errors/app-error';

export interface DecodedAuthToken {
  userId?: string;
  id?: string;
  email: string;
  userRole?: UserRole | string;
  role?: UserRole | string;
  tenantId?: string | null;
  isSuperAdmin?: boolean;
}

/**
 * Middleware untuk memvalidasi JSON Web Token (JWT) dari header Authorization.
 * Memastikan request berasal dari pengguna yang terotentikasi dan mengisi `req.user`.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction): void | Response => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Akses ditolak. Token otentikasi tidak ditemukan.',
      });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Akses ditolak. Token otentikasi tidak valid.',
      });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as DecodedAuthToken;

    const userId = decoded.userId || decoded.id;
    const userRole = (decoded.userRole || decoded.role) as UserRole;
    const tenantId = decoded.tenantId !== undefined ? decoded.tenantId : null;

    if (!userId || !decoded.email || !userRole) {
      return res.status(401).json({
        status: 'error',
        message: 'Akses ditolak. Payload token otentikasi tidak lengkap.',
      });
    }

    // Set objek req.user
    req.user = {
      id: userId,
      email: decoded.email,
      role: userRole,
      tenantId: tenantId,
    };

    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        status: 'error',
        message: 'Sesi Anda telah kedaluwarsa. Silakan login kembali.',
      });
    }

    return res.status(401).json({
      status: 'error',
      message: 'Token otentikasi tidak valid.',
    });
  }
};

/**
 * Middleware untuk membatasi akses berdasarkan role pengguna.
 *
 * @param allowedRoles Daftar role yang diizinkan mengakses endpoint
 */
export const requireRoles = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void | Response => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Akses ditolak. Pengguna belum terotentikasi.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Akses ditolak. Anda tidak memiliki izin untuk melakukan tindakan ini.',
      });
    }

    return next();
  };
};

export default authMiddleware;
