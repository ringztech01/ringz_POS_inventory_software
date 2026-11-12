-- Part 6e Step 4: a line's seat, course and "held" (touch POS). All null on
-- existing lines.

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `course` ENUM('STARTER', 'MAIN', 'DESSERT') NULL,
    ADD COLUMN `heldAt` DATETIME(3) NULL,
    ADD COLUMN `seat` INTEGER NULL;
