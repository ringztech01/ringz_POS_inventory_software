-- Part 6f Step 7e: the audit view (Settings › Restaurant › Audit log) needs the
-- new "View Audit Log" permission. The Administrator has every permission;
-- the built-in Manager role is given it here (the roles matrix can move it).
-- No schema change. Nothing else changes.

INSERT IGNORE INTO `RolePermission` (`id`, `roleId`, `permission`)
  SELECT REPLACE(UUID(), '-', ''), `id`, 'View Audit Log'
  FROM `Role`
  WHERE `systemRole` = 'MANAGER' AND `deletedAt` IS NULL;
