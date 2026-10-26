-- CreateTable
CREATE TABLE `SaleReturn` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'RECEIVED', 'COMPLETED') NOT NULL,
    `orderTax` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `orderTaxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `shipping` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `grandTotal` DECIMAL(12, 2) NOT NULL,
    `paid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `due` DECIMAL(12, 2) NOT NULL,
    `paymentStatus` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `SaleReturn_reference_key`(`reference`),
    INDEX `SaleReturn_deletedAt_idx`(`deletedAt`),
    INDEX `SaleReturn_saleId_idx`(`saleId`),
    INDEX `SaleReturn_customerId_idx`(`customerId`),
    INDEX `SaleReturn_warehouseId_idx`(`warehouseId`),
    INDEX `SaleReturn_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `returnId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `saleItemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `saleUnit` VARCHAR(191) NOT NULL,
    `netUnitPrice` DECIMAL(12, 2) NOT NULL,
    `discountType` ENUM('FIXED', 'PERCENTAGE') NOT NULL DEFAULT 'FIXED',
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxType` ENUM('EXCLUSIVE', 'INCLUSIVE') NOT NULL DEFAULT 'EXCLUSIVE',
    `orderTax` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `subtotal` DECIMAL(12, 2) NOT NULL,

    INDEX `SaleReturnItem_returnId_idx`(`returnId`),
    INDEX `SaleReturnItem_productId_idx`(`productId`),
    INDEX `SaleReturnItem_saleItemId_idx`(`saleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleReturnPayment` (
    `id` VARCHAR(191) NOT NULL,
    `saleReturnId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paymentType` ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE') NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `SaleReturnPayment_saleReturnId_idx`(`saleReturnId`),
    INDEX `SaleReturnPayment_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SaleReturn` ADD CONSTRAINT `SaleReturn_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturn` ADD CONSTRAINT `SaleReturn_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturn` ADD CONSTRAINT `SaleReturn_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturn` ADD CONSTRAINT `SaleReturn_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturnItem` ADD CONSTRAINT `SaleReturnItem_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `SaleReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturnItem` ADD CONSTRAINT `SaleReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturnItem` ADD CONSTRAINT `SaleReturnItem_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturnPayment` ADD CONSTRAINT `SaleReturnPayment_saleReturnId_fkey` FOREIGN KEY (`saleReturnId`) REFERENCES `SaleReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleReturnPayment` ADD CONSTRAINT `SaleReturnPayment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
