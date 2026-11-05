-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantDiscountLimitPercent` DECIMAL(5, 2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `billChangedAt` DATETIME(3) NULL,
    ADD COLUMN `discountApprovedById` VARCHAR(191) NULL,
    ADD COLUMN `discountById` VARCHAR(191) NULL,
    ADD COLUMN `discountReason` VARCHAR(140) NULL,
    ADD COLUMN `discountType` ENUM('PERCENT', 'AMOUNT') NULL,
    ADD COLUMN `discountValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `serviceCharge` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `ApprovalPin` (
    `userId` VARCHAR(191) NOT NULL,
    `pinHash` VARCHAR(191) NOT NULL,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Order_discountById_idx` ON `Order`(`discountById`);

-- CreateIndex
CREATE INDEX `Order_discountApprovedById_idx` ON `Order`(`discountApprovedById`);

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_discountById_fkey` FOREIGN KEY (`discountById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_discountApprovedById_fkey` FOREIGN KEY (`discountApprovedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalPin` ADD CONSTRAINT `ApprovalPin_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
