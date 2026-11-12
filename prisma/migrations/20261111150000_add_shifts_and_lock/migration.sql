-- Part 6f Step 6: sessions and switching user. Auto-lock gets a second
-- time for Managers and the Administrator (default 5 minutes; it applies
-- only while auto-lock is on — the current setting is kept as it is).
-- Clock in / out (off until an Administrator turns it on in Settings ›
-- Staff) keeps each shift here. Nothing else changes.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantClockInOut` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `restaurantPosLockSecondsManager` INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE `StaffShift` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `endReason` VARCHAR(10) NULL,
    `startDeviceId` VARCHAR(36) NULL,
    `endDeviceId` VARCHAR(36) NULL,

    INDEX `StaffShift_userId_endedAt_idx`(`userId`, `endedAt`),
    INDEX `StaffShift_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StaffShift` ADD CONSTRAINT `StaffShift_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
