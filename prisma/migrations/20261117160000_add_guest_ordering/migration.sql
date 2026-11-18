-- Restaurant Part 8, Step 7: guest ordering. Lines a guest sends from the
-- table's menu (GuestOrderLine: pending until a waiter confirms them, then
-- the order line they became), where an order came from (Order.source),
-- the caps and the pause switch (MenuSettings), and a KOT with no staff
-- author (a guest's order sent straight to the kitchen).

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `source` ENUM('STAFF', 'GUEST') NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE `MenuSettings` ADD COLUMN `guestOrderMaxLines` INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN `guestOrderMaxValue` DECIMAL(12, 2) NULL DEFAULT 100000,
    ADD COLUMN `guestOrderingPausedAt` DATETIME(3) NULL;

-- AlterTable: a KOT's author is optional (SET NULL like other optional authors).
ALTER TABLE `Kot` DROP FOREIGN KEY `Kot_createdById_fkey`;
ALTER TABLE `Kot` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `Kot` ADD CONSTRAINT `Kot_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `GuestOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sendId` VARCHAR(32) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `taxType` ENUM('EXCLUSIVE', 'INCLUSIVE') NOT NULL DEFAULT 'EXCLUSIVE',
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `modifiers` JSON NULL,
    `note` TEXT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `orderItemId` VARCHAR(191) NULL,
    `qrToken` VARCHAR(64) NOT NULL,
    `deviceId` VARCHAR(64) NOT NULL,
    `ipAddress` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GuestOrderLine_orderItemId_key`(`orderItemId`),
    INDEX `GuestOrderLine_orderId_status_idx`(`orderId`, `status`),
    INDEX `GuestOrderLine_qrToken_createdAt_idx`(`qrToken`, `createdAt`),
    INDEX `GuestOrderLine_deviceId_idx`(`deviceId`),
    INDEX `GuestOrderLine_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `GuestOrderLine_productId_idx`(`productId`),
    INDEX `GuestOrderLine_decidedById_idx`(`decidedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GuestOrderLine` ADD CONSTRAINT `GuestOrderLine_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuestOrderLine` ADD CONSTRAINT `GuestOrderLine_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuestOrderLine` ADD CONSTRAINT `GuestOrderLine_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuestOrderLine` ADD CONSTRAINT `GuestOrderLine_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
