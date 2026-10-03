import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { UserRole, TenantStatus } from '@prisma/client';
import { prisma, withTenantContext } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';

/**
 * Schema validasi untuk registrasi Owner & Tenant baru.
 */
export const registerOwnerSchema = z.object({
  storeName: z
    .string({ required_error: 'Nama toko wajib diisi' })
    .min(2, 'Nama toko minimal 2 karakter')
    .max(150, 'Nama toko maksimal 150 karakter'),
  slug: z
    .string()
    .min(2, 'Slug minimal 2 karakter')
    .max(100, 'Slug maksimal 100 karakter')
    .regex(/^[a-z0-9-]+$/, 'Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung (-)')
    .optional(),
  fullName: z
    .string({ required_error: 'Nama lengkap wajib diisi' })
    .min(2, 'Nama lengkap minimal 2 karakter')
    .max(150, 'Nama lengkap maksimal 150 karakter'),
  email: z
    .string({ required_error: 'Email wajib diisi' })
    .email('Format email tidak valid'),
  password: z
    .string({ required_error: 'Password wajib diisi' })
    .min(6, 'Password minimal 6 karakter'),
});

/**
 * Schema validasi untuk login pengguna.
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email wajib diisi' })
    .email('Format email tidak valid'),
  password: z
    .string({ required_error: 'Password wajib diisi' })
    .min(1, 'Password tidak boleh kosong'),
  tenantSlug: z.string().optional(),
  tenantId: z.string().uuid('Format Tenant ID harus berupa UUID valid').optional(),
});

export type RegisterOwnerDTO = z.infer<typeof registerOwnerSchema>;
export type LoginDTO = z.infer<typeof loginSchema>;

/**
 * Payload data yang disimpan di dalam JWT Token.
 */
export interface AuthTokenPayload {
  userId: string;
  tenantId: string | null;
  userRole: UserRole;
  role: UserRole;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * Mengubah string nama menjadi slug URL-friendly.
 */
export const slugify = (text: string): string => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

/**
 * Menghasilkan JSON Web Token (JWT) untuk user yang terotentikasi.
 */
export const generateAuthToken = (user: {
  id: string;
  tenantId: string | null;
  role: UserRole;
  email: string;
}): string => {
  const payload: AuthTokenPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    userRole: user.role,
    role: user.role,
    email: user.email,
    isSuperAdmin: user.role === UserRole.SuperAdmin,
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
};

export class AuthService {
  /**
   * Mendaftarkan Owner baru dan otomatis membuatkan data Tenant (Toko) baru.
   *
   * @param input Data registrasi toko dan pemilik
   * @returns Data pengguna, toko/tenant, dan token akses JWT
   */
  async registerOwner(input: RegisterOwnerDTO) {
    const validatedData = registerOwnerSchema.parse(input);
    const normalizedEmail = validatedData.email.trim().toLowerCase();
    const normalizedStoreName = validatedData.storeName.trim();
    const normalizedFullName = validatedData.fullName.trim();

    // 1. Tentukan slug toko
    let finalSlug = validatedData.slug?.trim().toLowerCase();
    if (!finalSlug) {
      const baseSlug = slugify(normalizedStoreName) || 'store';
      // Cek apakah baseSlug sudah ada
      const existing = await prisma.tenant.findUnique({ where: { slug: baseSlug } });
      if (existing) {
        const randomSuffix = Math.random().toString(36).substring(2, 6);
        finalSlug = `${baseSlug}-${randomSuffix}`;
      } else {
        finalSlug = baseSlug;
      }
    } else {
      // Jika slug dikirim secara manual, cek apakah sudah digunakan
      const existing = await prisma.tenant.findUnique({ where: { slug: finalSlug } });
      if (existing) {
        throw new AppError(`Slug toko '${finalSlug}' sudah digunakan. Silakan pilih slug lain.`, 409);
      }
    }

    // 2. Hash password menggunakan bcrypt
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(validatedData.password, saltRounds);

    // 3. Simpan Tenant dan User di dalam transaksi atomik dengan context RLS
    const result = await prisma.$transaction(async (tx) => {
      // 3a. Buat entri tenant baru
      const newTenant = await tx.tenant.create({
        data: {
          name: normalizedStoreName,
          slug: finalSlug!,
          status: TenantStatus.active,
        },
      });

      // 3b. Set parameter sesi RLS agar validasi RLS PostgreSQL mengizinkan pembuatan user
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${newTenant.id}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.is_superadmin = 'false';`);

      // 3c. Buat entri akun owner
      const newOwner = await tx.user.create({
        data: {
          tenantId: newTenant.id,
          fullName: normalizedFullName,
          email: normalizedEmail,
          passwordHash,
          role: UserRole.Owner,
          isActive: true,
        },
      });

      return { tenant: newTenant, user: newOwner };
    });

    // 4. Generate JWT Token
    const token = generateAuthToken(result.user);

    return {
      user: {
        id: result.user.id,
        fullName: result.user.fullName,
        email: result.user.email,
        role: result.user.role,
        tenantId: result.user.tenantId,
        createdAt: result.user.createdAt,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        status: result.tenant.status,
        createdAt: result.tenant.createdAt,
      },
      token,
    };
  }

  /**
   * Melakukan otentikasi user dan menghasilkan JWT token.
   *
   * @param input Data login (email, password, dan opsional tenantSlug/tenantId)
   * @returns Data pengguna, toko/tenant, dan token akses JWT
   */
  async login(input: LoginDTO) {
    const validatedData = loginSchema.parse(input);
    const normalizedEmail = validatedData.email.trim().toLowerCase();

    // Jalankan pencarian user dengan hak akses sistem (SuperAdmin context) agar tidak terhalang RLS pra-otentikasi
    const user = await withTenantContext(null, true, async (tx) => {
      let targetTenantId = validatedData.tenantId;

      // Jika tenantSlug disediakan, cari tenantId dari slug
      if (!targetTenantId && validatedData.tenantSlug) {
        const tenant = await tx.tenant.findUnique({
          where: { slug: validatedData.tenantSlug.trim().toLowerCase() },
        });
        if (!tenant) {
          throw new AppError('Toko / Tenant tidak ditemukan.', 404);
        }
        targetTenantId = tenant.id;
      }

      // Jika target tenant ID telah diketahui
      if (targetTenantId) {
        return await tx.user.findFirst({
          where: {
            email: normalizedEmail,
            tenantId: targetTenantId,
          },
          include: {
            tenant: true,
          },
        });
      }

      // Jika tidak ada tenantId maupun tenantSlug, cari user berdasarkan email
      const users = await tx.user.findMany({
        where: { email: normalizedEmail },
        include: { tenant: true },
      });

      if (users.length === 0) {
        return null;
      }

      if (users.length > 1) {
        throw new AppError(
          'Email terdaftar di beberapa toko. Mohon sertakan tenantSlug atau tenantId saat login.',
          400
        );
      }

      return users[0];
    });

    if (!user) {
      throw new AppError('Email atau password tidak valid.', 401);
    }

    // Periksa status aktif akun
    if (!user.isActive) {
      throw new AppError('Akun Anda dinonaktifkan. Silakan hubungi administrator.', 403);
    }

    // Periksa status tenant jika user terikat pada tenant
    if (user.tenant && user.tenant.status === TenantStatus.suspended) {
      throw new AppError('Layanan toko Anda sedang ditangguhkan (suspended). Silakan hubungi admin.', 403);
    }

    // Bandingkan password dengan hash menggunakan bcrypt
    const isPasswordValid = await bcrypt.compare(validatedData.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError('Email atau password tidak valid.', 401);
    }

    // Generate JWT Token
    const token = generateAuthToken(user);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenant: user.tenant
        ? {
            id: user.tenant.id,
            name: user.tenant.name,
            slug: user.tenant.slug,
            status: user.tenant.status,
          }
        : null,
      token,
    };
  }
}

export const authService = new AuthService();
export default authService;
