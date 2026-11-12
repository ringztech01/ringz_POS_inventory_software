-- Part 6f Step 4: PIN-only entry. A device an Administrator pairs as a
-- restaurant terminal always opens on the PIN screen; wrong PINs typed there
-- lock it for a while (longer each time). The PIN screen can hide the
-- on-shift names. Emergency access: one recovery code at a time (hashed).
-- Nothing is paired and no code exists until an Administrator does it.

-- AlterTable
ALTER TABLE `BusinessSetting` ADD COLUMN `recoveryCodeAt` DATETIME(3) NULL,
    ADD COLUMN `recoveryCodeHash` VARCHAR(100) NULL,
    ADD COLUMN `restaurantPinHideNames` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `pairedAt` DATETIME(3) NULL,
    ADD COLUMN `pinFailures` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pinLockLevel` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pinLockedUntil` DATETIME(3) NULL,
    ADD COLUMN `pinLogin` BOOLEAN NOT NULL DEFAULT false;
