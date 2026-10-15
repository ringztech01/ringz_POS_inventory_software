-- CreateTable
CREATE TABLE `Adjustment` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Adjustment_reference_key`(`reference`),
    INDEX `Adjustment_deletedAt_idx`(`deletedAt`),
    INDEX `Adjustment_warehouseId_idx`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdjustmentItem` (
    `id` VARCHAR(191) NOT NULL,
    `adjustmentId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `type` ENUM('ADDITION', 'SUBTRACTION') NOT NULL,

    INDEX `AdjustmentItem_adjustmentId_idx`(`adjustmentId`),
    INDEX `AdjustmentItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `ProductStock_productId_warehouseId_key` ON `ProductStock`(`productId`, `warehouseId`);

-- AddForeignKey
ALTER TABLE `Adjustment` ADD CONSTRAINT `Adjustment_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Adjustment` ADD CONSTRAINT `Adjustment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdjustmentItem` ADD CONSTRAINT `AdjustmentItem_adjustmentId_fkey` FOREIGN KEY (`adjustmentId`) REFERENCES `Adjustment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdjustmentItem` ADD CONSTRAINT `AdjustmentItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

