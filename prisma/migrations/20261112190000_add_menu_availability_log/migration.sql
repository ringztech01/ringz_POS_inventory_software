-- Restaurant Reports, Step 3: the 86 log. Each time a menu item's Available
-- switch changes, a row says so; By dish adds up the minutes each dish was
-- 86'd. Items already 86'd now get one "off" row at this moment, so their
-- time counts from here. Out of stock isn't recorded. Nothing else changes.

-- CreateTable
CREATE TABLE `MenuAvailabilityLog` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `available` BOOLEAN NOT NULL,
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MenuAvailabilityLog_productId_createdAt_idx`(`productId`, `createdAt`),
    INDEX `MenuAvailabilityLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MenuAvailabilityLog` ADD CONSTRAINT `MenuAvailabilityLog_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Items 86'd right now: their time starts here.
INSERT INTO `MenuAvailabilityLog` (`id`, `productId`, `available`, `userId`, `createdAt`)
  SELECT REPLACE(UUID(), '-', ''), p.`id`, 0, NULL, UTC_TIMESTAMP(3)
  FROM `Product` p
  WHERE p.`productType` = 'MENU_ITEM' AND p.`isAvailable` = 0 AND p.`deletedAt` IS NULL;
