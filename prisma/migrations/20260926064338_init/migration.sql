-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('SuperAdmin', 'Owner', 'Cashier');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'trial');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'qris', 'debit', 'transfer');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'trial',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100),
    "base_price" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "selling_price" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "outlet_name" VARCHAR(100) NOT NULL DEFAULT 'Main Outlet',
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "min_threshold" DECIMAL(12,2) NOT NULL DEFAULT 5.00,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "cashier_id" UUID NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "payment_method" "payment_method" NOT NULL DEFAULT 'cash',
    "payment_status" "payment_status" NOT NULL DEFAULT 'completed',
    "transaction_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_details" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "idx_users_tenant_id" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_email" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "idx_products_tenant_id" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_products_barcode" ON "products"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_product_sku" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "idx_inventory_stocks_tenant_product" ON "inventory_stocks"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_product_outlet" ON "inventory_stocks"("tenant_id", "product_id", "outlet_name");

-- CreateIndex
CREATE INDEX "idx_transactions_tenant_date" ON "transactions"("tenant_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "idx_transactions_cashier" ON "transactions"("tenant_id", "cashier_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_invoice_number" ON "transactions"("tenant_id", "invoice_number");

-- CreateIndex
CREATE INDEX "idx_trx_details_tenant_trx" ON "transaction_details"("tenant_id", "transaction_id");

-- CreateIndex
CREATE INDEX "idx_trx_details_product" ON "transaction_details"("tenant_id", "product_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
