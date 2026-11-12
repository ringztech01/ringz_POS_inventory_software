-- Part 6f Step 7d: staff cards. A card or badge (RFID/NFC or a barcode, read
-- by the scanner) signs someone in like their PIN. Kept as a keyed hash
-- only, unique per card. Only adds things: nobody has a card yet.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `cardHash` VARCHAR(64) NULL,
    ADD COLUMN `cardLabel` VARCHAR(12) NULL,
    ADD COLUMN `cardSetAt` DATETIME(3) NULL;
-- CreateIndex
CREATE UNIQUE INDEX `User_cardHash_key` ON `User`(`cardHash`);
