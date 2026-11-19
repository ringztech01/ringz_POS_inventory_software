-- Restaurant Part 6g, Step 1: which screens a device gets. AUTO (the
-- default, every existing device) works it out from the browser; an admin
-- can force TABLET or DESKTOP. touchScreen: what the browser said last.

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `screen` ENUM('AUTO', 'TABLET', 'DESKTOP') NOT NULL DEFAULT 'AUTO',
    ADD COLUMN `touchScreen` BOOLEAN NOT NULL DEFAULT false;
