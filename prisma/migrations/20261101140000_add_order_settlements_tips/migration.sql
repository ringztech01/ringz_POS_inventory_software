-- CreateTable
CREATE TABLE `OrderSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `partId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `tip` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `change` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL,
    `closedOrder` BOOLEAN NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `OrderSettlement_idempotencyKey_key`(`idempotencyKey`),
    INDEX `OrderSettlement_orderId_idx`(`orderId`),
    INDEX `OrderSettlement_partId_idx`(`partId`),
    INDEX `OrderSettlement_saleId_idx`(`saleId`),
    INDEX `OrderSettlement_createdById_idx`(`createdById`),
    INDEX `OrderSettlement_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderTip` (
    `id` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `waiterId` VARCHAR(191) NOT NULL,
    `paymentType` ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `OrderTip_settlementId_idx`(`settlementId`),
    INDEX `OrderTip_orderId_idx`(`orderId`),
    INDEX `OrderTip_waiterId_idx`(`waiterId`),
    INDEX `OrderTip_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderSettlement` ADD CONSTRAINT `OrderSettlement_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderSettlement` ADD CONSTRAINT `OrderSettlement_partId_fkey` FOREIGN KEY (`partId`) REFERENCES `OrderBillPart`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderSettlement` ADD CONSTRAINT `OrderSettlement_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderSettlement` ADD CONSTRAINT `OrderSettlement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderTip` ADD CONSTRAINT `OrderTip_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `OrderSettlement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderTip` ADD CONSTRAINT `OrderTip_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderTip` ADD CONSTRAINT `OrderTip_waiterId_fkey` FOREIGN KEY (`waiterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

