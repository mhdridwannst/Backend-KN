import { Router } from 'express';
import { transactionController } from './transaction.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';

const router = Router();

// Seluruh rute transaksi dilindungi otentikasi JWT dan identifikasi tenant RLS
router.use(authMiddleware);
router.use(tenantMiddleware);

/**
 * @route   POST /transactions
 * @desc    Proses checkout kasir (membuat transaksi penjualan baru dan memotong stok otomatis)
 * @access  Protected (Owner, Cashier, SuperAdmin)
 */
router.post('/', transactionController.createTransaction);

/**
 * @route   GET /transactions
 * @desc    Mengambil riwayat penjualan toko dengan filter tanggal, metode pembayaran, dan pagination
 * @access  Protected
 */
router.get('/', transactionController.getTransactions);

/**
 * @route   GET /transactions/:id
 * @desc    Mengambil detail faktur penjualan berdasarkan ID
 * @access  Protected
 */
router.get('/:id', transactionController.getTransactionById);

export { router as transactionRouter };
export default router;
