import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { transactionService } from './transaction.service';
import { AppError } from '../../common/errors/app-error';

export class TransactionController {
  /**
   * Menangani pembuatan transaksi penjualan baru (checkout kasir).
   * POST /transactions
   */
  createTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const transaction = await transactionService.createTransaction(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.user?.id,
        req.body
      );

      res.status(201).json({
        status: 'success',
        message: 'Transaksi penjualan berhasil diproses.',
        data: transaction,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Validasi item transaksi gagal.',
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
   * Mengambil riwayat transaksi penjualan toko yang sedang aktif.
   * GET /transactions
   */
  getTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await transactionService.getTransactions(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.query
      );

      res.status(200).json({
        status: 'success',
        message: 'Riwayat transaksi penjualan berhasil diambil.',
        data: result.items,
        meta: result.meta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Parameter filter transaksi tidak valid.',
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
   * Mengambil detail transaksi berdasarkan ID.
   * GET /transactions/:id
   */
  getTransactionById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const transaction = await transactionService.getTransactionById(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.params.id
      );

      res.status(200).json({
        status: 'success',
        message: 'Detail transaksi berhasil diambil.',
        data: transaction,
      });
    } catch (error) {
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

export const transactionController = new TransactionController();
export default transactionController;
