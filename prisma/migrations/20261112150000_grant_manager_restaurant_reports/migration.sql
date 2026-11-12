-- Restaurant Reports are for Managers and the Administrator. A fresh install's
-- Manager role already has "Restaurant Reports" (add_staff_roles); a Manager
-- role adopted from before keeps what it had, so it may not. This grants it
-- to the built-in Manager role only, if it's missing:
--   - idempotent: inserts nothing when the grant is there (run again: no-op)
--   - custom roles are left alone (the Administrator decides for those)
--   - only adds: no permission is removed or changed
-- No schema change.

INSERT INTO `RolePermission` (`id`, `roleId`, `permission`)
  SELECT REPLACE(UUID(), '-', ''), r.`id`, 'Restaurant Reports'
  FROM `Role` r
  WHERE r.`systemRole` = 'MANAGER'
    AND r.`deletedAt` IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM `RolePermission` p
      WHERE p.`roleId` = r.`id` AND p.`permission` = 'Restaurant Reports'
    );
