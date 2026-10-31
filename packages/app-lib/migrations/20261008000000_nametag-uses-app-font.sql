ALTER TABLE settings ADD COLUMN nametag_uses_app_font INTEGER NOT NULL DEFAULT 0 CHECK (nametag_uses_app_font IN (0, 1));
