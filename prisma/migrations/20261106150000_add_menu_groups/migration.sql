-- Part 6e Step 2: the touch POS's menu groups (a tree per department), each
-- dish's group and grid cell, and "after adding a dish, back to home".

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantPosReturnHome` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `menuGridPosition` INTEGER NULL,
    ADD COLUMN `menuGroupId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MenuGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `department` ENUM('FOOD', 'BAR') NOT NULL DEFAULT 'FOOD',
    `colour` VARCHAR(191) NULL,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `gridPosition` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `MenuGroup_parentId_idx`(`parentId`),
    INDEX `MenuGroup_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Product_menuGroupId_idx` ON `Product`(`menuGroupId`);

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_menuGroupId_fkey` FOREIGN KEY (`menuGroupId`) REFERENCES `MenuGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuGroup` ADD CONSTRAINT `MenuGroup_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `MenuGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
