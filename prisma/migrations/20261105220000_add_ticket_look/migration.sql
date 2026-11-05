-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `printFooter` TEXT NULL,
    ADD COLUMN `printHeader` TEXT NULL,
    ADD COLUMN `printKitchenLarge` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `printKotPrices` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `printLogo` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `printLogoData` MEDIUMBLOB NULL,
    ADD COLUMN `printLogoHeight` INTEGER NULL,
    ADD COLUMN `printLogoWidth` INTEGER NULL,
    ADD COLUMN `printQr` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `printQrText` VARCHAR(300) NULL;

