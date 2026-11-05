-- AlterTable
ALTER TABLE `Product` ADD COLUMN `stationId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `servedAt` DATETIME(3) NULL,
    ADD COLUMN `startedAt` DATETIME(3) NULL,
    ADD COLUMN `stationId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `KitchenStation` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `lateAfterMin` INTEGER NOT NULL DEFAULT 15,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `KitchenStation_code_key`(`code`),
    INDEX `KitchenStation_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Kot` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('NEW', 'VOID') NOT NULL DEFAULT 'NEW',
    `orderId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `printCount` INTEGER NOT NULL DEFAULT 0,
    `lastPrintedAt` DATETIME(3) NULL,
    `bumpedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Kot_number_key`(`number`),
    INDEX `Kot_stationId_bumpedAt_idx`(`stationId`, `bumpedAt`),
    INDEX `Kot_orderId_idx`(`orderId`),
    INDEX `Kot_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KotLine` (
    `id` VARCHAR(191) NOT NULL,
    `kotId` VARCHAR(191) NOT NULL,
    `orderItemId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `modifiers` TEXT NULL,
    `note` TEXT NULL,

    INDEX `KotLine_kotId_idx`(`kotId`),
    INDEX `KotLine_orderItemId_idx`(`orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Product_stationId_idx` ON `Product`(`stationId`);

-- CreateIndex
CREATE INDEX `OrderItem_stationId_kitchenStatus_idx` ON `OrderItem`(`stationId`, `kitchenStatus`);

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `KitchenStation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `KitchenStation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Kot` ADD CONSTRAINT `Kot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Kot` ADD CONSTRAINT `Kot_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `KitchenStation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Kot` ADD CONSTRAINT `Kot_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KotLine` ADD CONSTRAINT `KotLine_kotId_fkey` FOREIGN KEY (`kotId`) REFERENCES `Kot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KotLine` ADD CONSTRAINT `KotLine_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Data (restaurant Part 4) ----------------------------------------------------

-- The two stations.
INSERT INTO `KitchenStation` (`id`, `name`, `code`, `lateAfterMin`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`) VALUES
    ('station_kitchen', 'Kitchen', 'KIT', 15, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('station_bar', 'Bar', 'BAR', 15, 1, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- stationId from the existing prepStation / station values (KITCHEN → KIT,
-- BAR → BAR). Only the new column is written.
UPDATE `Product` p
    JOIN `KitchenStation` s ON s.`code` = (CASE p.`prepStation` WHEN 'KITCHEN' THEN 'KIT' WHEN 'BAR' THEN 'BAR' END)
    SET p.`stationId` = s.`id`
    WHERE p.`prepStation` IS NOT NULL;

UPDATE `OrderItem` i
    JOIN `KitchenStation` s ON s.`code` = (CASE i.`station` WHEN 'KITCHEN' THEN 'KIT' WHEN 'BAR' THEN 'BAR' END)
    SET i.`stationId` = s.`id`;

-- The Kitchen, Bar and Waiter roles: created if missing (no role of that
-- name, deleted or not), then Kitchen and Bar get Kitchen Display and Manage
-- Kitchen, Waiter gets Kitchen Display. The admin (isSystem) role has every
-- permission already.
INSERT INTO `Role` (`id`, `name`, `isSystem`, `createdAt`, `updatedAt`)
    SELECT v.`id`, v.`name`, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
    FROM (SELECT 'role_kitchen' AS `id`, 'Kitchen' AS `name` UNION ALL SELECT 'role_bar', 'Bar' UNION ALL SELECT 'role_waiter', 'Waiter') v
    WHERE NOT EXISTS (SELECT 1 FROM `Role` r WHERE r.`name` = v.`name`);

INSERT IGNORE INTO `RolePermission` (`id`, `roleId`, `permission`)
    SELECT CONCAT('rp_', r.`id`, '_', g.`key`), r.`id`, g.`permission`
    FROM `Role` r
    JOIN (
        SELECT 'Kitchen' AS `role`, 'kd' AS `key`, 'Kitchen Display' AS `permission`
        UNION ALL SELECT 'Kitchen', 'mk', 'Manage Kitchen'
        UNION ALL SELECT 'Bar', 'kd', 'Kitchen Display'
        UNION ALL SELECT 'Bar', 'mk', 'Manage Kitchen'
        UNION ALL SELECT 'Waiter', 'kd', 'Kitchen Display'
    ) g ON g.`role` = r.`name`
    WHERE r.`deletedAt` IS NULL AND r.`isSystem` = false;
