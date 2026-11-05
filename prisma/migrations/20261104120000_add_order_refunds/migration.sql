-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `stockPerUnit` JSON NULL;

-- CreateTable
CREATE TABLE `OrderRefund` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `saleReturnId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `returnedToStock` BOOLEAN NOT NULL,
    `stockMoves` JSON NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `OrderRefund_saleReturnId_key`(`saleReturnId`),
    UNIQUE INDEX `OrderRefund_idempotencyKey_key`(`idempotencyKey`),
    INDEX `OrderRefund_orderId_idx`(`orderId`),
    INDEX `OrderRefund_createdById_idx`(`createdById`),
    INDEX `OrderRefund_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderRefund` ADD CONSTRAINT `OrderRefund_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRefund` ADD CONSTRAINT `OrderRefund_saleReturnId_fkey` FOREIGN KEY (`saleReturnId`) REFERENCES `SaleReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRefund` ADD CONSTRAINT `OrderRefund_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

