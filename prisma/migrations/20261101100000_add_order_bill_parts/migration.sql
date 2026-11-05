-- CreateTable
CREATE TABLE `OrderBillPart` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `mode` ENUM('EQUAL', 'ITEMS', 'AMOUNT') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('OPEN', 'PAID') NOT NULL DEFAULT 'OPEN',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `OrderBillPart_orderId_idx`(`orderId`),
    INDEX `OrderBillPart_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderBillPartLine` (
    `id` VARCHAR(191) NOT NULL,
    `partId` VARCHAR(191) NOT NULL,
    `orderItemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,

    INDEX `OrderBillPartLine_orderItemId_idx`(`orderItemId`),
    UNIQUE INDEX `OrderBillPartLine_partId_orderItemId_key`(`partId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderBillPart` ADD CONSTRAINT `OrderBillPart_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderBillPartLine` ADD CONSTRAINT `OrderBillPartLine_partId_fkey` FOREIGN KEY (`partId`) REFERENCES `OrderBillPart`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderBillPartLine` ADD CONSTRAINT `OrderBillPartLine_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

