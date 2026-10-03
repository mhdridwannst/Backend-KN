import { z } from 'zod';
import { Prisma, PaymentMethod, PaymentStatus } from '@prisma/client';
import { withTenantContext } from '../../config/database';
import { AppError } from '../../common/errors/app-error';

/**
 * Schema item belanjaan transaksi.
 */
export const transactionItemSchema = z.object({
  productId: z
    .string({ required_error: 'Product ID wajib diisi' })
    .uuid('Product ID harus berupa UUID valid'),
  quantity: z
    .coerce
    .number({ invalid_type_error: 'Kuantitas harus berupa angka' })
    .positive('Kuantitas belanja harus lebih besar dari 0'),
});

/**
 * Schema pembuatan transaksi baru (checkout).
 */
export const createTransactionSchema = z.object({
  items: z
    .array(transactionItemSchema, { required_error: 'Item transaksi wajib diisi' })
    .min(1, 'Transaksi minimal harus memiliki 1 item barang'),
  paymentMethod: z
    .nativeEnum(PaymentMethod, {
      errorMap: () => ({ message: 'Metode pembayaran tidak valid (cash, qris, debit, transfer)' }),
    })
    .default(PaymentMethod.cash),
  taxAmount: z
    .coerce
    .number({ invalid_type_error: 'Pajak harus berupa angka' })
    .min(0, 'Pajak tidak boleh negatif')
    .optional()
    .default(0),
  discountAmount: z
    .coerce
    .number({ invalid_type_error: 'Diskon harus berupa angka' })
    .min(0, 'Diskon tidak boleh negatif')
    .optional()
    .default(0),
  outletName: z
    .string()
    .max(100, 'Nama outlet maksimal 100 karakter')
    .optional()
    .default('Main Outlet'),
});

/**
 * Schema query filter untuk riwayat transaksi.
 */
export const transactionQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  cashierId: z.string().uuid().optional(),
});

export type TransactionItemDTO = z.infer<typeof transactionItemSchema>;
export type CreateTransactionDTO = z.infer<typeof createTransactionSchema>;
export type TransactionQueryDTO = z.infer<typeof transactionQuerySchema>;

export class TransactionService {
  /**
   * Membuat transaksi penjualan baru (checkout kasir).
   * Menjalankan kalkulasi harga otomatis, validasi stok, dan pemotongan stok secara atomik di dalam Prisma Transaction dengan RLS.
   *
   * @param tenantId UUID tenant dari kasir/toko yang sedang aktif
   * @param isSuperAdmin boolean hak akses SuperAdmin
   * @param cashierId UUID pengguna/kasir yang memproses transaksi
   * @param input Data transaksi beserta daftar item
   */
  async createTransaction(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    cashierId: string | undefined,
    input: CreateTransactionDTO
  ) {
    if (!tenantId) {
      throw new AppError('Tenant ID wajib disertakan untuk melakukan transaksi.', 400);
    }

    if (!cashierId) {
      throw new AppError('Identitas kasir (cashierId) tidak ditemukan.', 401);
    }

    const validatedData = createTransactionSchema.parse(input);
    const outlet = validatedData.outletName || 'Main Outlet';

    // 1. Gabungkan item duplikat dalam request belanja jika ada
    const itemMap = new Map<string, number>();
    for (const item of validatedData.items) {
      itemMap.set(item.productId, (itemMap.get(item.productId) || 0) + item.quantity);
    }

    const uniqueProductIds = Array.from(itemMap.keys());

    // 2. Jalankan seluruh proses checkout di dalam transaksi database yang dilindungi RLS
    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      // 2a. Ambil data produk yang dibeli dan verifikasi kepemilikan tenant
      const products = await tx.product.findMany({
        where: {
          id: { in: uniqueProductIds },
          tenantId,
        },
      });

      if (products.length !== uniqueProductIds.length) {
        const foundIds = new Set(products.map((p) => p.id));
        const missingIds = uniqueProductIds.filter((id) => !foundIds.has(id));
        throw new AppError(
          `Satu atau lebih produk tidak ditemukan pada toko ini: ${missingIds.join(', ')}`,
          404
        );
      }

      // 2b. Ambil stok inventori untuk produk-produk tersebut pada outlet terkait
      const stocks = await tx.inventoryStock.findMany({
        where: {
          tenantId,
          productId: { in: uniqueProductIds },
          outletName: outlet,
        },
      });

      const stockMap = new Map(stocks.map((s) => [s.productId, s]));

      // 2c. Validasi kecukupan stok barang
      for (const product of products) {
        const requestedQty = itemMap.get(product.id)!;
        const stockRecord = stockMap.get(product.id);
        const availableQty = stockRecord ? Number(stockRecord.quantity) : 0;

        if (!stockRecord || availableQty < requestedQty) {
          throw new AppError(
            `Stok tidak mencukupi untuk '${product.name}' (SKU: ${product.sku}). Tersedia: ${availableQty}, Diminta: ${requestedQty}.`,
            400
          );
        }
      }

      // 2d. Kalkulasi subtotal tiap item dan total amount
      let subtotalSum = new Prisma.Decimal(0);
      const transactionDetailsData: Array<{
        tenantId: string;
        productId: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        subtotal: Prisma.Decimal;
      }> = [];

      for (const product of products) {
        const qty = itemMap.get(product.id)!;
        const unitPrice = product.sellingPrice;
        const itemSubtotal = unitPrice.mul(new Prisma.Decimal(qty));

        subtotalSum = subtotalSum.add(itemSubtotal);

        transactionDetailsData.push({
          tenantId,
          productId: product.id,
          quantity: new Prisma.Decimal(qty),
          unitPrice,
          subtotal: itemSubtotal,
        });
      }

      const tax = new Prisma.Decimal(validatedData.taxAmount);
      const discount = new Prisma.Decimal(validatedData.discountAmount);
      const totalAmount = subtotalSum.add(tax).sub(discount);

      if (totalAmount.lt(0)) {
        throw new AppError('Total nilai transaksi tidak boleh negatif.', 400);
      }

      // 2e. Buat nomor invoice unik berbasis tanggal dan kode acak
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      const invoiceNumber = `INV-${datePart}-${randomSuffix}`;

      // 2f. Simpan data transaksi dan detail transaksi
      const transaction = await tx.transaction.create({
        data: {
          tenantId,
          invoiceNumber,
          cashierId,
          totalAmount,
          taxAmount: tax,
          discountAmount: discount,
          paymentMethod: validatedData.paymentMethod,
          paymentStatus: PaymentStatus.completed,
          transactionDate: now,
          details: {
            create: transactionDetailsData,
          },
        },
        include: {
          details: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  category: true,
                },
              },
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      // 2g. Potong stok barang di tabel inventory_stocks secara atomik
      for (const product of products) {
        const qty = itemMap.get(product.id)!;
        await tx.inventoryStock.update({
          where: {
            tenantId_productId_outletName: {
              tenantId,
              productId: product.id,
              outletName: outlet,
            },
          },
          data: {
            quantity: {
              decrement: new Prisma.Decimal(qty),
            },
          },
        });
      }

      return transaction;
    });
  }

  /**
   * Mengambil riwayat transaksi penjualan terisolasi per tenant dengan pagination dan filter.
   */
  async getTransactions(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    queryParams?: unknown
  ) {
    const query = transactionQuerySchema.parse(queryParams ?? {});
    const skip = (query.page - 1) * query.limit;

    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      const where: Prisma.TransactionWhereInput = {};

      if (tenantId) {
        where.tenantId = tenantId;
      }

      if (query.paymentMethod) {
        where.paymentMethod = query.paymentMethod;
      }

      if (query.cashierId) {
        where.cashierId = query.cashierId;
      }

      if (query.startDate || query.endDate) {
        where.transactionDate = {};
        if (query.startDate) {
          where.transactionDate.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          const end = new Date(query.endDate);
          // Set ke akhir hari jika formatnya tanggal YYYY-MM-DD
          if (query.endDate.length <= 10) {
            end.setHours(23, 59, 59, 999);
          }
          where.transactionDate.lte = end;
        }
      }

      const [transactions, total] = await Promise.all([
        tx.transaction.findMany({
          where,
          skip,
          take: query.limit,
          orderBy: { transactionDate: 'desc' },
          include: {
            details: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                  },
                },
              },
            },
            cashier: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        }),
        tx.transaction.count({ where }),
      ]);

      return {
        items: transactions,
        meta: {
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    });
  }

  /**
   * Mengambil detail satu transaksi penjualan berdasarkan ID.
   */
  async getTransactionById(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    id: string
  ) {
    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      const transaction = await tx.transaction.findFirst({
        where: {
          id,
          ...(tenantId ? { tenantId } : {}),
        },
        include: {
          details: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  barcode: true,
                  category: true,
                },
              },
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!transaction) {
        throw new AppError('Transaksi tidak ditemukan.', 404);
      }

      return transaction;
    });
  }
}

export const transactionService = new TransactionService();
export default transactionService;
