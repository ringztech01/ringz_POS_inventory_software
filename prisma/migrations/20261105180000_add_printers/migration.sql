-- CreateTable
CREATE TABLE `Printer` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `name` VARCHAR(80) NOT NULL,
    `connection` ENUM('OS', 'USB', 'NETWORK', 'SERIAL') NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `paperWidth` INTEGER NOT NULL DEFAULT 80,
    `codePage` VARCHAR(20) NOT NULL DEFAULT 'PC437',
    `cut` ENUM('FULL', 'PARTIAL', 'NONE') NOT NULL DEFAULT 'PARTIAL',
    `openDrawer` BOOLEAN NOT NULL DEFAULT false,
    `drawerPin` INTEGER NOT NULL DEFAULT 2,
    `baudRate` INTEGER NOT NULL DEFAULT 9600,
    `model` VARCHAR(120) NULL,
    `identity` JSON NULL,
    `lastStatus` VARCHAR(20) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Printer_businessId_idx`(`businessId`),
    INDEX `Printer_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrinterAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `role` VARCHAR(40) NOT NULL,
    `stationId` VARCHAR(191) NULL,
    `printerId` VARCHAR(191) NOT NULL,
    `fallbackPrinterId` VARCHAR(191) NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PrinterAssignment_stationId_idx`(`stationId`),
    INDEX `PrinterAssignment_printerId_idx`(`printerId`),
    INDEX `PrinterAssignment_fallbackPrinterId_idx`(`fallbackPrinterId`),
    UNIQUE INDEX `PrinterAssignment_businessId_role_key`(`businessId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NULL,
    `userAgent` VARCHAR(255) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Device_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceOverride` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(40) NOT NULL,
    `printerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeviceOverride_printerId_idx`(`printerId`),
    UNIQUE INDEX `DeviceOverride_deviceId_role_key`(`deviceId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Printer` ADD CONSTRAINT `Printer_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrinterAssignment` ADD CONSTRAINT `PrinterAssignment_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrinterAssignment` ADD CONSTRAINT `PrinterAssignment_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `KitchenStation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrinterAssignment` ADD CONSTRAINT `PrinterAssignment_printerId_fkey` FOREIGN KEY (`printerId`) REFERENCES `Printer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrinterAssignment` ADD CONSTRAINT `PrinterAssignment_fallbackPrinterId_fkey` FOREIGN KEY (`fallbackPrinterId`) REFERENCES `Printer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceOverride` ADD CONSTRAINT `DeviceOverride_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceOverride` ADD CONSTRAINT `DeviceOverride_printerId_fkey` FOREIGN KEY (`printerId`) REFERENCES `Printer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

