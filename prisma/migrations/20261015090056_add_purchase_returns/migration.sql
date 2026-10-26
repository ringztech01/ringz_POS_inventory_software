-- CreateTable
CREATE TABLE `PurchaseReturn` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `purchaseId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'ORDERED', 'RECEIVED') NOT NULL,
    `orderTax` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `orderTaxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `shipping` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `grandTotal` DECIMAL(12, 2) NOT NULL,
    `paid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `due` DECIMAL(12, 2) NOT NULL,
    `paymentType` ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE') NOT NULL DEFAULT 'CASH',
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PurchaseReturn_reference_key`(`reference`),
    INDEX `PurchaseReturn_deletedAt_idx`(`deletedAt`),
    INDEX `PurchaseReturn_supplierId_idx`(`supplierId`),
    INDEX `PurchaseReturn_warehouseId_idx`(`warehouseId`),
    INDEX `PurchaseReturn_purchaseId_idx`(`purchaseId`),
    INDEX `PurchaseReturn_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `returnId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `purchaseUnit` VARCHAR(191) NOT NULL,
    `netUnitCost` DECIMAL(12, 2) NOT NULL,
    `discountType` ENUM('FIXED', 'PERCENTAGE') NOT NULL DEFAULT 'FIXED',
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxType` ENUM('EXCLUSIVE', 'INCLUSIVE') NOT NULL DEFAULT 'EXCLUSIVE',
    `orderTax` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `subtotal` DECIMAL(12, 2) NOT NULL,

    INDEX `PurchaseReturnItem_returnId_idx`(`returnId`),
    INDEX `PurchaseReturnItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnItem` ADD CONSTRAINT `PurchaseReturnItem_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `PurchaseReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnItem` ADD CONSTRAINT `PurchaseReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
