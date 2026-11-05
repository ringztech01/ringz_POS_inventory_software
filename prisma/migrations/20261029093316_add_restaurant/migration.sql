-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantBookingGapMinutes` INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN `restaurantManualCleaning` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `restaurantReservedWindowMinutes` INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `menuDescription` TEXT NULL,
    ADD COLUMN `menuImage` VARCHAR(191) NULL,
    ADD COLUMN `prepStation` ENUM('KITCHEN', 'BAR') NULL,
    ADD COLUMN `productType` ENUM('STANDARD', 'MENU_ITEM', 'INGREDIENT') NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN `showOnMenu` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `DiningArea` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `DiningArea_deletedAt_idx`(`deletedAt`),
    INDEX `DiningArea_warehouseId_idx`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Table` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,
    `seats` INTEGER NOT NULL,
    `qrToken` VARCHAR(191) NOT NULL,
    `needsCleaning` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Table_qrToken_key`(`qrToken`),
    INDEX `Table_deletedAt_idx`(`deletedAt`),
    INDEX `Table_areaId_idx`(`areaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY') NOT NULL DEFAULT 'DINE_IN',
    `status` ENUM('OPEN', 'SENT', 'SERVED', 'BILLED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `tableId` VARCHAR(191) NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `waiterId` VARCHAR(191) NULL,
    `guests` INTEGER NOT NULL DEFAULT 1,
    `saleId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    -- Hand-edited: Prisma can't express a partial unique index, and MySQL has
    -- none. This column is the table while the order holds it (OPEN, SENT or
    -- SERVED, not deleted) and NULL otherwise, so the unique index below
    -- allows at most one such order per table. MySQL fills it in; the app
    -- never writes it. (No NULL / NOT NULL here: MariaDB doesn't allow either
    -- on a generated column; it's nullable.)
    `activeTableId` VARCHAR(191) GENERATED ALWAYS AS (IF(`status` IN ('OPEN', 'SENT', 'SERVED') AND `deletedAt` IS NULL, `tableId`, NULL)) STORED,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Order_number_key`(`number`),
    UNIQUE INDEX `Order_saleId_key`(`saleId`),
    UNIQUE INDEX `Order_activeTableId_key`(`activeTableId`),
    INDEX `Order_deletedAt_idx`(`deletedAt`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_tableId_idx`(`tableId`),
    INDEX `Order_warehouseId_idx`(`warehouseId`),
    INDEX `Order_customerId_idx`(`customerId`),
    INDEX `Order_waiterId_idx`(`waiterId`),
    INDEX `Order_openedAt_idx`(`openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `taxType` ENUM('EXCLUSIVE', 'INCLUSIVE') NOT NULL DEFAULT 'EXCLUSIVE',
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `modifiers` JSON NULL,
    `note` TEXT NULL,
    `station` ENUM('KITCHEN', 'BAR') NOT NULL DEFAULT 'KITCHEN',
    `kitchenStatus` ENUM('NEW', 'PENDING', 'PREPARING', 'READY', 'SERVED') NOT NULL DEFAULT 'NEW',
    `sentAt` DATETIME(3) NULL,
    `readyAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `OrderItem_orderId_idx`(`orderId`),
    INDEX `OrderItem_productId_idx`(`productId`),
    INDEX `OrderItem_kitchenStatus_idx`(`kitchenStatus`),
    INDEX `OrderItem_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModifierGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `minSelect` INTEGER NOT NULL DEFAULT 0,
    `maxSelect` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `ModifierGroup_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Modifier` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Modifier_groupId_idx`(`groupId`),
    INDEX `Modifier_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipeLine` (
    `id` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `ingredientId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `RecipeLine_menuItemId_idx`(`menuItemId`),
    INDEX `RecipeLine_ingredientId_idx`(`ingredientId`),
    INDEX `RecipeLine_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `guestName` VARCHAR(191) NOT NULL,
    `guestPhone` VARCHAR(191) NOT NULL,
    `partySize` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `status` ENUM('BOOKED', 'SEATED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'BOOKED',
    `notes` TEXT NULL,
    `orderId` VARCHAR(191) NULL,
    `seatedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Reservation_orderId_key`(`orderId`),
    INDEX `Reservation_deletedAt_idx`(`deletedAt`),
    INDEX `Reservation_tableId_idx`(`tableId`),
    INDEX `Reservation_customerId_idx`(`customerId`),
    INDEX `Reservation_startsAt_idx`(`startsAt`),
    INDEX `Reservation_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ModifierGroupToProduct` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ModifierGroupToProduct_AB_unique`(`A`, `B`),
    INDEX `_ModifierGroupToProduct_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Product_productType_idx` ON `Product`(`productType`);

-- AddForeignKey
ALTER TABLE `DiningArea` ADD CONSTRAINT `DiningArea_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Table` ADD CONSTRAINT `Table_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `DiningArea`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `Table`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_waiterId_fkey` FOREIGN KEY (`waiterId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Modifier` ADD CONSTRAINT `Modifier_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `ModifierGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeLine` ADD CONSTRAINT `RecipeLine_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipeLine` ADD CONSTRAINT `RecipeLine_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `Table`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ModifierGroupToProduct` ADD CONSTRAINT `_ModifierGroupToProduct_A_fkey` FOREIGN KEY (`A`) REFERENCES `ModifierGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ModifierGroupToProduct` ADD CONSTRAINT `_ModifierGroupToProduct_B_fkey` FOREIGN KEY (`B`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

