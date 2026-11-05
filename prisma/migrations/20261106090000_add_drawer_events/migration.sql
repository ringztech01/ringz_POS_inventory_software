-- AlterTable
ALTER TABLE `PrintJob` MODIFY `type` ENUM('KOT', 'KOT_VOID', 'RECEIPT', 'PREBILL', 'REPORT', 'TEST', 'DRAWER') NOT NULL;

-- CreateTable
CREATE TABLE `DrawerEvent` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `reason` ENUM('CASH_SALE', 'CASH_REFUND', 'MANUAL', 'TEST') NOT NULL,
    `note` VARCHAR(140) NULL,
    `printerId` VARCHAR(191) NOT NULL,
    `printJobId` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NULL,
    `refLabel` VARCHAR(80) NULL,
    `userId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DrawerEvent_printJobId_key`(`printJobId`),
    INDEX `DrawerEvent_businessId_idx`(`businessId`),
    INDEX `DrawerEvent_createdAt_idx`(`createdAt`),
    INDEX `DrawerEvent_reason_createdAt_idx`(`reason`, `createdAt`),
    INDEX `DrawerEvent_printerId_idx`(`printerId`),
    INDEX `DrawerEvent_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DrawerEvent` ADD CONSTRAINT `DrawerEvent_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DrawerEvent` ADD CONSTRAINT `DrawerEvent_printerId_fkey` FOREIGN KEY (`printerId`) REFERENCES `Printer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DrawerEvent` ADD CONSTRAINT `DrawerEvent_printJobId_fkey` FOREIGN KEY (`printJobId`) REFERENCES `PrintJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DrawerEvent` ADD CONSTRAINT `DrawerEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

