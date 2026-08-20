-- ローカル検証専用: 模擬 auth.users にデモユーザーを作る。
-- 実環境では Admin API (npm run seed:users) が同じ4名を作成する。
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@eagle.example',  '{"name":"経営管理者","role":"ADMIN"}'),
  ('22222222-2222-2222-2222-222222222222', 'tanaka@eagle.example', '{"name":"田中 健一","role":"COACH"}'),
  ('33333333-3333-3333-3333-333333333333', 'sato@eagle.example',   '{"name":"佐藤 美咲","role":"COACH"}'),
  ('44444444-4444-4444-4444-444444444444', 'suzuki@eagle.example', '{"name":"鈴木 大輔","role":"COACH"}')
on conflict (id) do nothing;
