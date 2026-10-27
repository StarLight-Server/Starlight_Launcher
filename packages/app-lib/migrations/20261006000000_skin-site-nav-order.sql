-- Skin site navigation card order is stored per-user settings so each
-- launcher can customize the order of tabs shown in SkinSiteNavCards.
ALTER TABLE settings ADD COLUMN skin_site_nav_order TEXT NULL;
