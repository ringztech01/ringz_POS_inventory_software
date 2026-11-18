-- Restaurant Part 8, Step 2: the address the QR codes open (the server on the
-- restaurant's network), chosen by an admin on Digital menu › QR codes. Null
-- until then: no codes are printed.

-- AlterTable
ALTER TABLE `MenuSettings` ADD COLUMN `menuBaseUrl` VARCHAR(200) NULL;
