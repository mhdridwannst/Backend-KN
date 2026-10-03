import { Router } from 'express';
import { productController } from './product.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';

const router = Router();

/**
 * Seluruh endpoint produk diproteksi secara berurutan:
 * 1. authMiddleware: Memastikan token otentikasi valid dan mengisi req.user.
 * 2. tenantMiddleware: Memastikan tenant ID valid dan mengisi req.tenantId serta req.isSuperAdmin.
 */
router.use(authMiddleware);
router.use(tenantMiddleware);

/**
 * @route   POST /products
 * @desc    Membuat produk baru untuk tenant aktif
 * @access  Protected (Owner, Cashier, SuperAdmin)
 */
router.post('/', productController.createProduct);

/**
 * @route   GET /products
 * @desc    Mengambil daftar produk dengan filter kategori, pencarian, dan pagination
 * @access  Protected
 */
router.get('/', productController.getProducts);

/**
 * @route   GET /products/:id
 * @desc    Mengambil detail produk berdasarkan ID
 * @access  Protected
 */
router.get('/:id', productController.getProductById);

/**
 * @route   PUT /products/:id
 * @desc    Memperbarui data produk
 * @access  Protected
 */
router.put('/:id', productController.updateProduct);

/**
 * @route   POST /products/:id/restock
 * @desc    Menambah jumlah stok produk secara cepat
 * @access  Protected
 */
router.post('/:id/restock', productController.restockProduct);

/**
 * @route   DELETE /products/:id
 * @desc    Menghapus produk dari inventori (jika belum ada riwayat transaksi)
 * @access  Protected
 */
router.delete('/:id', productController.deleteProduct);

export { router as productRouter };
export default router;
