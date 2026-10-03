import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { authService } from './auth.service';
import { AppError } from '../../common/errors/app-error';

export class AuthController {
  /**
   * Menangani request registrasi Owner dan Toko baru.
   * POST /auth/register
   */
  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.registerOwner(req.body);

      res.status(201).json({
        status: 'success',
        message: 'Registrasi toko dan akun owner berhasil.',
        data: result,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Validasi input gagal.',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
        return;
      }

      next(error);
    }
  };

  /**
   * Menangani request login pengguna (Owner, Cashier, SuperAdmin).
   * POST /auth/login
   */
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Izinkan tenantId diambil dari header x-tenant-id jika tidak ada di body
      const headerTenantId = (
        Array.isArray(req.headers['x-tenant-id'])
          ? req.headers['x-tenant-id'][0]
          : req.headers['x-tenant-id']
      )?.trim();

      const loginPayload = {
        ...req.body,
        tenantId: req.body.tenantId || headerTenantId || undefined,
      };

      const result = await authService.login(loginPayload);

      res.status(200).json({
        status: 'success',
        message: 'Login berhasil.',
        data: result,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Validasi input gagal.',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }

      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
        return;
      }

      next(error);
    }
  };
}

export const authController = new AuthController();
export default authController;
