-- Part 6f Step 7c: device roles. A paired device is a PIN terminal (POS,
-- as every paired device is now), the Kitchen screen or a Bar terminal (on
-- its area). Only adds things: every device stays POS.

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `homeAreaId` VARCHAR(191) NULL,
    ADD COLUMN `terminalRole` ENUM('POS', 'KITCHEN', 'BAR') NOT NULL DEFAULT 'POS';
-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_homeAreaId_fkey` FOREIGN KEY (`homeAreaId`) REFERENCES `DiningArea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
