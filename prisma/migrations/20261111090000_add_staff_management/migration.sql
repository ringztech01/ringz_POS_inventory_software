-- Part 6f Step 3: staff management. Staff get a display name, a colour, a
-- default area or station, a disabled state (instead of deleting), their
-- last sign-in and device, and a session version (+1 ends every session they
-- have). PINs now follow rules (4 digits, unique, not weak); the ones set
-- before are marked so the staff list can ask for a reset — they keep
-- working until then. Two Administrator settings: allow weak PINs, and let
-- staff change their own PIN.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `restaurantAllowWeakPins` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `restaurantStaffSelfPin` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `colour` VARCHAR(7) NULL,
    ADD COLUMN `disabledAt` DATETIME(3) NULL,
    ADD COLUMN `displayName` VARCHAR(40) NULL,
    ADD COLUMN `homeAreaId` VARCHAR(191) NULL,
    ADD COLUMN `homeStation` VARCHAR(20) NULL,
    ADD COLUMN `lastDeviceId` VARCHAR(64) NULL,
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `pinOnly` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ApprovalPin` ADD COLUMN `meetsRules` BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_homeAreaId_fkey` FOREIGN KEY (`homeAreaId`) REFERENCES `DiningArea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- PINs set before these rules: kept, flagged for a reset.
UPDATE `ApprovalPin` SET `meetsRules` = false;
