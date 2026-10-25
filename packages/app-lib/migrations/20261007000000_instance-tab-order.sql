-- Instance page tab order (content/files/screenshots/worlds/logs) is
-- stored per-user so each launcher can reorder the instance page tabs.
ALTER TABLE settings ADD COLUMN instance_tab_order TEXT NULL;
