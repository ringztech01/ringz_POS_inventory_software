-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `remakeOfId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `OrderItem_remakeOfId_idx` ON `OrderItem`(`remakeOfId`);

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_remakeOfId_fkey` FOREIGN KEY (`remakeOfId`) REFERENCES `OrderItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

