import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

/**
 * Menjalankan operasi Prisma di dalam transaksi terisolasi dengan PostgreSQL Row Level Security (RLS).
 *
 * @param tenantId UUID tenant dari pengguna aktif (atau null jika SuperAdmin)
 * @param isSuperAdmin boolean apakah pengguna memiliki hak akses SuperAdmin
 * @param callback fungsi callback berisi operasi database yang terlindungi RLS
 */
export async function withTenantContext<T>(
  tenantId: string | null | undefined,
  isSuperAdmin: boolean,
  callback: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // 1. Set parameter sesi transaksi untuk RLS
    const sanitizedTenantId = tenantId ? tenantId.replace(/'/g, "''") : '';
    const superAdminFlag = isSuperAdmin ? 'true' : 'false';

    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${sanitizedTenantId}';`);
    await tx.$executeRawUnsafe(`SET LOCAL app.is_superadmin = '${superAdminFlag}';`);

    // 2. Jalankan logic dengan context transaksi yang terlindungi
    return await callback(tx);
  });
}
