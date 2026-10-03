import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { withTenantContext } from '../../config/database';
import { AppError } from '../../common/errors/app-error';

/**
 * Schema validasi untuk pembuatan produk baru.
 */
export const createProductSchema = z.object({
  name: z
    .string({ required_error: 'Nama produk wajib diisi' })
    .min(2, 'Nama produk minimal 2 karakter')
    .max(200, 'Nama produk maksimal 200 karakter'),
  sku: z
    .string({ required_error: 'SKU produk wajib diisi' })
    .min(2, 'SKU minimal 2 karakter')
    .max(64, 'SKU maksimal 64 karakter')
    .regex(/^[a-zA-Z0-9_-]+$/, 'SKU hanya boleh alfanumerik, garis bawah (_), atau strip (-)'),
  barcode: z
    .string()
    .max(64, 'Barcode maksimal 64 karakter')
    .optional()
    .nullable(),
  category: z
    .string()
    .max(100, 'Kategori maksimal 100 karakter')
    .optional()
    .nullable(),
  basePrice: z
    .coerce
    .number({ invalid_type_error: 'Harga modal harus berupa angka' })
    .min(0, 'Harga modal tidak boleh negatif')
    .default(0),
  sellingPrice: z
    .coerce
    .number({ invalid_type_error: 'Harga jual harus berupa angka' })
    .min(0, 'Harga jual tidak boleh negatif'),
  initialStock: z
    .coerce
    .number({ invalid_type_error: 'Stok awal harus berupa angka' })
    .min(0, 'Stok awal tidak boleh negatif')
    .optional()
    .default(0),
  minThreshold: z
    .coerce
    .number({ invalid_type_error: 'Batas minimum stok harus berupa angka' })
    .min(0, 'Batas minimum stok tidak boleh negatif')
    .optional()
    .default(5),
});

/**
 * Schema validasi untuk pembaruan produk.
 */
export const updateProductSchema = createProductSchema.partial().omit({ initialStock: true });

/**
 * Schema validasi query parameter untuk daftar produk.
 */
export const productQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'createdAt', 'sellingPrice', 'basePrice']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateProductDTO = z.infer<typeof createProductSchema>;
export type UpdateProductDTO = z.infer<typeof updateProductSchema>;
export type ProductQueryDTO = z.infer<typeof productQuerySchema>;

export class ProductService {
  /**
   * Membuat produk baru yang otomatis terisolasi pada tenant saat ini via withTenantContext.
   */
  async createProduct(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    input: CreateProductDTO
  ) {
    if (!tenantId) {
      throw new AppError('Tenant ID wajib ditentukan untuk membuat data produk.', 400);
    }

    const validatedData = createProductSchema.parse(input);

    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      // 1. Validasi apakah SKU sudah digunakan di tenant ini
      const existingSku = await tx.product.findUnique({
        where: {
          tenantId_sku: {
            tenantId,
            sku: validatedData.sku,
          },
        },
      });

      if (existingSku) {
        throw new AppError(`SKU '${validatedData.sku}' sudah terdaftar pada toko ini.`, 409);
      }

      // 2. Buat produk baru
      const product = await tx.product.create({
        data: {
          tenantId,
          name: validatedData.name.trim(),
          sku: validatedData.sku.trim(),
          barcode: validatedData.barcode?.trim() || null,
          category: validatedData.category?.trim() || null,
          basePrice: new Prisma.Decimal(validatedData.basePrice),
          sellingPrice: new Prisma.Decimal(validatedData.sellingPrice),
        },
      });

      // 3. Otomatis inisialisasi stok awal di outlet utama (Main Outlet)
      const stock = await tx.inventoryStock.create({
        data: {
          tenantId,
          productId: product.id,
          outletName: 'Main Outlet',
          quantity: new Prisma.Decimal(validatedData.initialStock),
          minThreshold: new Prisma.Decimal(validatedData.minThreshold),
        },
      });

      return {
        ...product,
        inventoryStocks: [stock],
      };
    });
  }

  /**
   * Mengambil daftar produk terisolasi per tenant dengan pencarian dan pagination.
   */
  async getProducts(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    queryParams?: unknown
  ) {
    const query = productQuerySchema.parse(queryParams ?? {});
    const skip = (query.page - 1) * query.limit;

    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      const where: Prisma.ProductWhereInput = {};

      if (tenantId) {
        where.tenantId = tenantId;
      }

      if (query.category) {
        where.category = { equals: query.category, mode: 'insensitive' };
      }

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [products, total] = await Promise.all([
        tx.product.findMany({
          where,
          skip,
          take: query.limit,
          orderBy: { [query.sortBy]: query.sortOrder },
          include: {
            inventoryStocks: true,
          },
        }),
        tx.product.count({ where }),
      ]);

      return {
        items: products,
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
   * Mengambil data detail produk berdasarkan ID dengan isolasi RLS.
   */
  async getProductById(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    id: string
  ) {
    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      const product = await tx.product.findFirst({
        where: {
          id,
          ...(tenantId ? { tenantId } : {}),
        },
        include: {
          inventoryStocks: true,
        },
      });

      if (!product) {
        throw new AppError('Produk tidak ditemukan.', 404);
      }

      return product;
    });
  }

  /**
   * Memperbarui informasi produk dengan pengecekan kepemilikan tenant.
   */
  async updateProduct(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    id: string,
    input: UpdateProductDTO
  ) {
    const validatedData = updateProductSchema.parse(input);

    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      // 1. Cek apakah produk ada dan milik tenant ini
      const existingProduct = await tx.product.findFirst({
        where: {
          id,
          ...(tenantId ? { tenantId } : {}),
        },
      });

      if (!existingProduct) {
        throw new AppError('Produk tidak ditemukan.', 404);
      }

      // 2. Jika SKU diubah, pastikan tidak duplikat dengan produk lain di tenant yang sama
      if (validatedData.sku && validatedData.sku !== existingProduct.sku) {
        const duplicateSku = await tx.product.findFirst({
          where: {
            tenantId: existingProduct.tenantId,
            sku: validatedData.sku,
            NOT: { id },
          },
        });

        if (duplicateSku) {
          throw new AppError(`SKU '${validatedData.sku}' sudah digunakan oleh produk lain.`, 409);
        }
      }

      // 3. Update produk
      const updateData: Prisma.ProductUpdateInput = {};
      if (validatedData.name !== undefined) updateData.name = validatedData.name.trim();
      if (validatedData.sku !== undefined) updateData.sku = validatedData.sku.trim();
      if (validatedData.barcode !== undefined) updateData.barcode = validatedData.barcode?.trim() || null;
      if (validatedData.category !== undefined) updateData.category = validatedData.category?.trim() || null;
      if (validatedData.basePrice !== undefined) updateData.basePrice = new Prisma.Decimal(validatedData.basePrice);
      if (validatedData.sellingPrice !== undefined) updateData.sellingPrice = new Prisma.Decimal(validatedData.sellingPrice);

      const updatedProduct = await tx.product.update({
        where: { id },
        data: updateData,
        include: {
          inventoryStocks: true,
        },
      });

      return updatedProduct;
    });
  }

  /**
   * Menghapus produk dari database (dengan validasi transaksi penjualan).
   */
  async deleteProduct(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    id: string
  ) {
    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      // 1. Cek keberadaan produk
      const existingProduct = await tx.product.findFirst({
        where: {
          id,
          ...(tenantId ? { tenantId } : {}),
        },
      });

      if (!existingProduct) {
        throw new AppError('Produk tidak ditemukan.', 404);
      }

      // 2. Pastikan produk belum pernah tercatat di riwayat transaksi penjualan
      const transactionCount = await tx.transactionDetail.count({
        where: { productId: id },
      });

      if (transactionCount > 0) {
        throw new AppError(
          'Produk tidak dapat dihapus karena sudah memiliki riwayat transaksi penjualan.',
          400
        );
      }

      // 3. Hapus produk (stok inventori terkait akan otomatis terhapus via onDelete: Cascade)
      await tx.product.delete({
        where: { id },
      });

      return {
        id: existingProduct.id,
        name: existingProduct.name,
        sku: existingProduct.sku,
      };
    });
  }

  /**
   * Menambahkan stok produk (restock).
   */
  async restockProduct(
    tenantId: string | null | undefined,
    isSuperAdmin: boolean,
    id: string,
    quantityToAdd: number,
    outletName = 'Main Outlet'
  ) {
    if (!tenantId) {
      throw new AppError('Tenant ID wajib ditentukan.', 400);
    }
    if (quantityToAdd <= 0) {
      throw new AppError('Jumlah restock harus lebih besar dari 0.', 400);
    }

    return await withTenantContext(tenantId, isSuperAdmin, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!product) {
        throw new AppError('Produk tidak ditemukan.', 404);
      }

      const stock = await tx.inventoryStock.upsert({
        where: {
          tenantId_productId_outletName: {
            tenantId,
            productId: id,
            outletName,
          },
        },
        create: {
          tenantId,
          productId: id,
          outletName,
          quantity: new Prisma.Decimal(quantityToAdd),
          minThreshold: new Prisma.Decimal(5),
        },
        update: {
          quantity: {
            increment: new Prisma.Decimal(quantityToAdd),
          },
        },
      });

      return {
        product,
        stock,
      };
    });
  }
}

export const productService = new ProductService();
export default productService;
