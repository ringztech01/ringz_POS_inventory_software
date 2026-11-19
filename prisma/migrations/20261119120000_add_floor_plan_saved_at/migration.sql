-- Restaurant (6g follow-up 3): when an area's floor plan was last saved in
-- the floor plan editor (or an event layout put on its floor). Not yet: every
-- floor draws its tables in a grid by number, and the editor starts from it.
-- Adding a table on the Tables page moves layoutVersion on too, so that
-- can't tell. Filled in from the audit log for areas already saved.

-- AlterTable
ALTER TABLE `DiningArea` ADD COLUMN `floorPlanSavedAt` DATETIME(3) NULL;

-- Backfill
UPDATE `DiningArea` a SET `floorPlanSavedAt` = (
  SELECT MAX(l.`createdAt`) FROM `AuditLog` l
  WHERE l.`entityType` = 'DiningArea' AND l.`entityId` = a.`id`
    AND l.`action` IN ('floor.layout.save', 'floor.layout.switch', 'floor.layout.restore')
);
