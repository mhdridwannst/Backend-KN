import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { productService } from './product.service';
import { AppError } from '../../common/errors/app-error';

export class ProductController {
  /**
   * Menangani pembuatan produk baru.
   * POST /products
   */
  createProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const product = await productService.createProduct(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.body
      );

      res.status(201).json({
        status: 'success',
        message: 'Produk berhasil dibuat.',
        data: product,
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
   * Mengambil daftar produk untuk tenant yang sedang aktif.
   * GET /products
   */
  getProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await productService.getProducts(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.query
      );

      res.status(200).json({
        status: 'success',
        message: 'Daftar produk berhasil diambil.',
        data: result.items,
        meta: result.meta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Parameter query tidak valid.',
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
   * Mengambil detail satu produk berdasarkan ID.
   * GET /products/:id
   */
  getProductById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const product = await productService.getProductById(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.params.id
      );

      res.status(200).json({
        status: 'success',
        message: 'Detail produk berhasil diambil.',
        data: product,
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

  /**
   * Memperbarui informasi produk.
   * PUT /products/:id
   */
  updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const product = await productService.updateProduct(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.params.id,
        req.body
      );

      res.status(200).json({
        status: 'success',
        message: 'Produk berhasil diperbarui.',
        data: product,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: 'error',
          message: 'Validasi pembaruan produk gagal.',
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
   * Menghapus produk.
   * DELETE /products/:id
   */
  deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await productService.deleteProduct(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.params.id
      );

      res.status(200).json({
        status: 'success',
        message: 'Produk berhasil dihapus.',
        data: result,
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

  /**
   * Menambah stok produk (Restock).
   * POST /products/:id/restock
   */
  restockProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const quantityToAdd = Number(req.body.quantity);
      if (isNaN(quantityToAdd) || quantityToAdd <= 0) {
        res.status(400).json({
          status: 'error',
          message: 'Jumlah penambahan stok harus berupa angka positif.',
        });
        return;
      }

      const result = await productService.restockProduct(
        req.tenantId,
        req.isSuperAdmin ?? false,
        req.params.id,
        quantityToAdd,
        req.body.outletName || 'Main Outlet'
      );

      res.status(200).json({
        status: 'success',
        message: 'Stok produk berhasil ditambahkan.',
        data: result,
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

export const productController = new ProductController();
export default productController;
