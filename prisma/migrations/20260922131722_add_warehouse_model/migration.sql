-- CreateTable
CREATE TABLE `Warehouse` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `zipCode` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Warehouse_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
