-- Part 6f Step 7f: training mode. A person in training mode (Settings ›
-- Staff) opens TRAINING orders: the real floor, but nothing printed to or
-- shown in the kitchen, no stock moved, no sale when settled. Only adds
-- things: nobody is in training, every order stays real.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `trainingMode` BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `training` BOOLEAN NOT NULL DEFAULT false;
