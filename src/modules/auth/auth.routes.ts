import { Router } from 'express';
import { authController } from './auth.controller';

const router = Router();

/**
 * @route   POST /auth/register
 * @desc    Registrasi Owner baru sekaligus membuat Tenant (Toko) baru
 * @access  Public
 */
router.post('/register', authController.register);

/**
 * @route   POST /auth/login
 * @desc    Login pengguna (Owner, Cashier, SuperAdmin) dan mendapatkan JWT Token
 * @access  Public
 */
router.post('/login', authController.login);

export { router as authRouter };
export default router;
