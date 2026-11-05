-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantServiceChargePercent` DECIMAL(5, 2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `cancelReason` VARCHAR(191) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `cancelledById` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `OrderItem_cancelledById_idx` ON `OrderItem`(`cancelledById`);

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

