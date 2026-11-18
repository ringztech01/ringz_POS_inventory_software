-- The guest menu's look (after Part 8): SHOWCASE, the dark one with the
-- dishes up front, is the default (an existing menu switches to it);
-- CLASSIC, the light, plain one, stays a choice in Digital menu › QR codes.

-- AlterTable
ALTER TABLE `MenuSettings` ADD COLUMN `menuDesign` ENUM('SHOWCASE', 'CLASSIC') NOT NULL DEFAULT 'SHOWCASE';
