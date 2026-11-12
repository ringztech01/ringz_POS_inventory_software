-- Part 6f Step 7b: cash-up per till. A till (a device) is opened with a
-- float and closed with the cash counted; payments, cash tips and refunds
-- taken on it while it's open point to its session. Only adds things:
-- existing payments keep tillSessionId NULL.

-- AlterTable
ALTER TABLE `SalePayment` ADD COLUMN `tillSessionId` VARCHAR(191) NULL;
-- AlterTable
ALTER TABLE `SaleReturnPayment` ADD COLUMN `tillSessionId` VARCHAR(191) NULL;
-- AlterTable
ALTER TABLE `OrderTip` ADD COLUMN `tillSessionId` VARCHAR(191) NULL;
-- CreateTable
CREATE TABLE `TillSession` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `openedById` VARCHAR(191) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `float` DECIMAL(12, 2) NOT NULL,
    `closedById` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `cashSales` DECIMAL(12, 2) NULL,
    `cashTips` DECIMAL(12, 2) NULL,
    `cashRefunds` DECIMAL(12, 2) NULL,
    `expected` DECIMAL(12, 2) NULL,
    `counted` DECIMAL(12, 2) NULL,
    `variance` DECIMAL(12, 2) NULL,
    `note` VARCHAR(200) NULL,
    `zPrintedAt` DATETIME(3) NULL,
    INDEX `TillSession_deviceId_closedAt_idx`(`deviceId`, `closedAt`),
    INDEX `TillSession_openedAt_idx`(`openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateIndex
CREATE INDEX `SalePayment_tillSessionId_idx` ON `SalePayment`(`tillSessionId`);
-- CreateIndex
CREATE INDEX `SaleReturnPayment_tillSessionId_idx` ON `SaleReturnPayment`(`tillSessionId`);
-- CreateIndex
CREATE INDEX `OrderTip_tillSessionId_idx` ON `OrderTip`(`tillSessionId`);
-- AddForeignKey
ALTER TABLE `SalePayment` ADD CONSTRAINT `SalePayment_tillSessionId_fkey` FOREIGN KEY (`tillSessionId`) REFERENCES `TillSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `SaleReturnPayment` ADD CONSTRAINT `SaleReturnPayment_tillSessionId_fkey` FOREIGN KEY (`tillSessionId`) REFERENCES `TillSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `OrderTip` ADD CONSTRAINT `OrderTip_tillSessionId_fkey` FOREIGN KEY (`tillSessionId`) REFERENCES `TillSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `TillSession` ADD CONSTRAINT `TillSession_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `TillSession` ADD CONSTRAINT `TillSession_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
