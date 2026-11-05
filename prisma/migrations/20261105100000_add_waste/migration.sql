-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantWarehouseId` VARCHAR(191) NULL,
    ADD COLUMN `restaurantWasteAmberPercent` DECIMAL(5, 2) NOT NULL DEFAULT 5,
    ADD COLUMN `restaurantWasteApprovalLimit` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `restaurantWasteRedPercent` DECIMAL(5, 2) NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE `WasteEntry` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `warehouseId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(12, 3) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `reason` ENUM('BURNT', 'EXPIRED', 'DROPPED', 'RETURNED_BY_GUEST', 'OVERPRODUCTION', 'OTHER') NOT NULL,
    `note` VARCHAR(300) NULL,
    `costSnapshot` DECIMAL(12, 2) NOT NULL,
    `orderItemId` VARCHAR(191) NULL,
    `loggedById` VARCHAR(191) NOT NULL,
    `approvedById` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
    `voidOfId` VARCHAR(191) NULL,
    `voidReason` VARCHAR(300) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `WasteEntry_voidOfId_key`(`voidOfId`),
    INDEX `WasteEntry_businessId_createdAt_idx`(`businessId`, `createdAt`),
    INDEX `WasteEntry_businessId_reason_idx`(`businessId`, `reason`),
    INDEX `WasteEntry_productId_idx`(`productId`),
    INDEX `WasteEntry_warehouseId_idx`(`warehouseId`),
    INDEX `WasteEntry_orderItemId_idx`(`orderItemId`),
    INDEX `WasteEntry_loggedById_idx`(`loggedById`),
    INDEX `WasteEntry_approvedById_idx`(`approvedById`),
    INDEX `WasteEntry_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WasteEntryLine` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(12, 3) NOT NULL,
    `unitCost` DECIMAL(12, 2) NOT NULL,
    `lineCost` DECIMAL(12, 2) NOT NULL,

    INDEX `WasteEntryLine_entryId_idx`(`entryId`),
    INDEX `WasteEntryLine_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BusinessSetting` ADD CONSTRAINT `BusinessSetting_restaurantWarehouseId_fkey` FOREIGN KEY (`restaurantWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_loggedById_fkey` FOREIGN KEY (`loggedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntry` ADD CONSTRAINT `WasteEntry_voidOfId_fkey` FOREIGN KEY (`voidOfId`) REFERENCES `WasteEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntryLine` ADD CONSTRAINT `WasteEntryLine_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `WasteEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WasteEntryLine` ADD CONSTRAINT `WasteEntryLine_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: the restaurant's warehouse is the one its dining areas use (the
-- first live area's). Waste is taken out of it.
UPDATE `BusinessSetting`
SET `restaurantWarehouseId` = (SELECT `warehouseId` FROM `DiningArea` WHERE `deletedAt` IS NULL ORDER BY `createdAt` LIMIT 1)
WHERE `restaurantWarehouseId` IS NULL;
