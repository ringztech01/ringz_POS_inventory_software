-- Restaurant Part 8, Step 1: the digital menu's schema.
--
-- QR tokens: every table already has one (Table.qrToken, NOT NULL and
-- UNIQUE since the tables migration), made on the server by
-- lib/qrToken.ts: 18 random bytes, base64url, 144 bits. There is nothing to
-- generate here, and SQL can't make cryptographic random tokens on MariaDB
-- 10.4 (no RANDOM_BYTES). Rotating keeps that rule (Step 2). qrRotatedAt
-- starts empty: no token has been rotated.

-- AlterTable: the menu photo keeps its data (menuImage → photoPath); the
-- card's description is 300 characters at most (the longest today is 60).
ALTER TABLE `Product` CHANGE COLUMN `menuImage` `photoPath` VARCHAR(191) NULL,
    ADD COLUMN `allergens` JSON NULL,
    ADD COLUMN `calories` INTEGER NULL,
    ADD COLUMN `isSignature` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mediaType` ENUM('PHOTO', 'SPIN', 'MODEL') NOT NULL DEFAULT 'PHOTO',
    ADD COLUMN `modelGlbPath` VARCHAR(191) NULL,
    ADD COLUMN `modelUsdzPath` VARCHAR(191) NULL,
    ADD COLUMN `spinFrames` JSON NULL,
    MODIFY `menuDescription` VARCHAR(300) NULL;

-- AlterTable
ALTER TABLE `Table` ADD COLUMN `qrRotatedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `QrPoint` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `name` VARCHAR(80) NOT NULL,
    `qrToken` VARCHAR(191) NOT NULL,
    `orderType` ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'BAR_TAB') NOT NULL,
    `qrRotatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `QrPoint_qrToken_key`(`qrToken`),
    INDEX `QrPoint_businessId_deletedAt_idx`(`businessId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuSettings` (
    `id` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `menuEnabled` BOOLEAN NOT NULL DEFAULT true,
    `guestOrderingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoSendGuestOrders` BOOLEAN NOT NULL DEFAULT false,
    `requireWaiterConfirm` BOOLEAN NOT NULL DEFAULT true,
    `showPrices` BOOLEAN NOT NULL DEFAULT true,
    `showSoldOut` BOOLEAN NOT NULL DEFAULT true,
    `showCalories` BOOLEAN NOT NULL DEFAULT true,
    `showAllergens` BOOLEAN NOT NULL DEFAULT true,
    `menuTitle` VARCHAR(80) NULL,
    `welcomeText` VARCHAR(300) NULL,
    `footerText` VARCHAR(300) NULL,
    `logoPath` VARCHAR(191) NULL,
    `accentColour` VARCHAR(7) NOT NULL DEFAULT '#0f7d6a',
    `currencyDisplay` ENUM('SYMBOL', 'CODE') NOT NULL DEFAULT 'SYMBOL',
    `callWaiterEnabled` BOOLEAN NOT NULL DEFAULT false,
    `requestBillEnabled` BOOLEAN NOT NULL DEFAULT false,
    `wifiName` VARCHAR(64) NULL,
    `wifiPassword` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MenuSettings_businessId_key`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `QrPoint` ADD CONSTRAINT `QrPoint_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuSettings` ADD CONSTRAINT `MenuSettings_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessSetting`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The business's menu settings, with the defaults (guest ordering off).
INSERT INTO `MenuSettings` (`id`, `businessId`, `updatedAt`)
SELECT CONCAT('menu_', REPLACE(UUID(), '-', '')), b.`id`, CURRENT_TIMESTAMP(3)
FROM `BusinessSetting` b
WHERE b.`id` = 'default' AND NOT EXISTS (SELECT 1 FROM `MenuSettings` m WHERE m.`businessId` = b.`id`);
