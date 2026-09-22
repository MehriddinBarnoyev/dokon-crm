-- ============================================================
--  QURILMALAR — xavfsizlik uchun
--
--  Token 90 kun yashaydi va JWT o'zi-o'zicha to'liq (`lib/auth.ts` dagi
--  izohga qarang) — hisobga QAYSI qurilmadan va QACHONDAN beri kirib
--  turgani hech qayerda ko'rinmasdi. Shubhali kirish (o'g'irlangan token,
--  begona telefon) shu tarzda sezilmay qolardi.
--
--  `first_seen_at` — o'rnatilgan vaqtga eng yaqin proksi: na iOS, na
--  Android ilova o'rnatilgan vaqtni ochiq API orqali bermaydi, shuning
--  uchun "qurilma serverga birinchi marta ulangan vaqt" ishlatiladi.
--  `last_seen_at` va `app_version` — oxirgi faollik va joriy versiyani
--  (demak, yangilanganini) kuzatish uchun.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  platform      text,
  model         text,
  os_version    text,
  app_version   text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS user_devices_user_idx ON user_devices(user_id);
