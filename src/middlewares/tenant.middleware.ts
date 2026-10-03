import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { env } from '../config/env';

/**
 * Regular expression untuk memvalidasi format UUID (v1-v7 atau nil UUID).
 * Pola 8-4-4-4-12 hex sesuai spesifikasi RFC 4122 / PostgreSQL type UUID.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Memvalidasi apakah string merupakan UUID yang valid.
 *
 * @param id string yang akan divalidasi
 * @returns boolean true jika format valid UUID
 */
export const isValidUuid = (id: string): boolean => {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
};

/**
 * Payload data yang diharapkan dari token JWT.
 */
export interface JwtCustomPayload extends JwtPayload {
  id?: string;
  userId?: string;
  email?: string;
  role?: UserRole | string;
  tenantId?: string | null;
  tenant_id?: string | null;
  isSuperAdmin?: boolean;
}

export interface TenantMiddlewareOptions {
  /**
   * Menentukan apakah tenant ID wajib ada untuk request non-SuperAdmin.
   * Jika true (default), akan melempar HTTP 400 jika tenant ID tidak ditemukan.
   * Jika false, req.tenantId diisi null dan eksekusi tetap dilanjutkan.
   */
  required?: boolean;
}

/**
 * Factory function untuk membuat middleware identifikasi tenant dengan opsi kustom.
 */
export const createTenantMiddleware = (options: TenantMiddlewareOptions = { required: true }) => {
  const isRequired = options.required ?? true;

  return (req: Request, res: Response, next: NextFunction): void | Response => {
    try {
      // 1. Ekstraksi Tenant ID dari HTTP Header (x-tenant-id)
      const rawHeader = req.headers['x-tenant-id'];
      const headerTenantId = (
        Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
      )?.trim() || null;

      // 2. Ekstraksi Tenant ID & Role dari JWT Token atau req.user yang sudah didecode
      let tokenPayload: JwtCustomPayload | null = null;

      if (req.user) {
        // Jika sudah diautentikasi oleh auth middleware sebelumnya
        tokenPayload = {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          tenantId: req.user.tenantId,
        };
      } else {
        const authHeader = req.headers.authorization;
        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7).trim();
          if (token) {
            try {
              tokenPayload = jwt.verify(token, env.JWT_SECRET) as JwtCustomPayload;
            } catch {
              // Jika token rusak atau kedaluwarsa
              return res.status(401).json({
                status: 'error',
                message: 'Invalid or expired authorization token.',
              });
            }
          }
        }
      }

      const tokenRole = tokenPayload?.role;
      const isSuperAdmin = Boolean(
        req.user?.role === UserRole.SuperAdmin ||
        tokenRole === UserRole.SuperAdmin ||
        tokenRole === 'SuperAdmin' ||
        tokenPayload?.isSuperAdmin === true
      );

      const tokenTenantId =
        req.user?.tenantId ??
        tokenPayload?.tenantId ??
        tokenPayload?.tenant_id ??
        null;

      // 3. Resolusi Tenant ID & Perlindungan Keamanan (Tenant Spoofing)
      let resolvedTenantId: string | null = null;

      if (isSuperAdmin) {
        // SuperAdmin dapat mengakses data secara global (null) atau bertindak atas nama tenant tertentu (via header)
        resolvedTenantId = headerTenantId;
      } else {
        // Non-SuperAdmin: Cegah spoofing jika header berbeda dengan tenant ID di dalam token
        if (tokenTenantId && headerTenantId && tokenTenantId !== headerTenantId) {
          return res.status(403).json({
            status: 'error',
            message: 'Tenant access forbidden: Header tenant ID does not match authenticated token tenant ID.',
          });
        }

        resolvedTenantId = tokenTenantId ?? headerTenantId;
      }

      // 4. Validasi Format UUID
      if (resolvedTenantId) {
        if (!isValidUuid(resolvedTenantId)) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid Tenant ID format. Must be a valid UUID.',
          });
        }
      } else if (isRequired && !isSuperAdmin) {
        // Jika wajib dan bukan SuperAdmin tetapi tidak ada tenant ID
        return res.status(400).json({
          status: 'error',
          message: "Tenant ID is required. Please provide 'x-tenant-id' header or authenticate with a valid tenant token.",
        });
      }

      // 5. Menyimpan tenantId dan status isSuperAdmin ke dalam objek Request Express
      req.tenantId = resolvedTenantId;
      req.isSuperAdmin = isSuperAdmin;

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

/**
 * Middleware utama identifikasi tenant (strict: required = true by default).
 * Memvalidasi keberadaan tenant ID (kecuali SuperAdmin), format UUID,
 * serta menyimpan `req.tenantId` dan `req.isSuperAdmin`.
 */
export const tenantMiddleware = createTenantMiddleware({ required: true });

/**
 * Middleware opsional identifikasi tenant (required = false).
 * Mengisi `req.tenantId` jika ada tanpa memblokir request jika tidak disediakan.
 */
export const optionalTenantMiddleware = createTenantMiddleware({ required: false });

export default tenantMiddleware;
