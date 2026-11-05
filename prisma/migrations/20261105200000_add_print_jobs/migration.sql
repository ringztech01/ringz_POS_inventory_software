-- CreateTable
CREATE TABLE `PrintJob` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `printerId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(40) NULL,
    `type` ENUM('KOT', 'KOT_VOID', 'RECEIPT', 'PREBILL', 'REPORT', 'TEST') NOT NULL,
    `refId` VARCHAR(191) NULL,
    `label` VARCHAR(160) NOT NULL,
    `template` VARCHAR(20) NOT NULL,
    `data` JSON NOT NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('QUEUED', 'PRINTING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NULL,
    `reprint` BOOLEAN NOT NULL DEFAULT false,
    `reprintOfId` VARCHAR(191) NULL,
    `reroutedFromPrinterId` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `deviceId` VARCHAR(64) NULL,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `printedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PrintJob_dedupeKey_key`(`dedupeKey`),
    INDEX `PrintJob_printerId_status_createdAt_idx`(`printerId`, `status`, `createdAt`),
    INDEX `PrintJob_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `PrintJob_type_refId_idx`(`type`, `refId`),
    INDEX `PrintJob_createdAt_idx`(`createdAt`),
    INDEX `PrintJob_businessId_idx`(`businessId`),
    INDEX `PrintJob_reroutedFromPrinterId_idx`(`reroutedFromPrinterId`),
    INDEX `PrintJob_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_printerId_fkey` FOREIGN KEY (`printerId`) REFERENCES `Printer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_reroutedFromPrinterId_fkey` FOREIGN KEY (`reroutedFromPrinterId`) REFERENCES `Printer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

