import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import productRoutes from '../modules/product/product.routes';
import transactionRoutes from '../modules/transaction/transaction.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/transactions', transactionRoutes);

export default router;
