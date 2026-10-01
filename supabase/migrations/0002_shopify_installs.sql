-- Shopify public app: every store that installs "Apex Data" is recorded here (token encrypted, server only),
-- whether or not an Apex client has been linked to it yet. A strategist later links the shop to a client in
-- Store Settings; that creates the usual integrations row from this install.
create table shopify_installs (
  shop text primary key,                          -- store-name.myshopify.com
  ciphertext text,                                -- AES-GCM {access_token, scope, apiVersion}; null after uninstall
  scope text,
  installed_at timestamptz not null default now(),
  uninstalled_at timestamptz
);
alter table shopify_installs enable row level security; -- no policies: service role (server) only
