# Setup do SaaS — Estilusótica Dash

O que precisa existir para o SaaS funcionar de ponta a ponta:
login → conectar Meta Ads do cliente → dashboard com as métricas dele.

## 1. Projeto Supabase (backend) — ✅ FEITO (2026-07-18)

Projeto: **`zkdeczpqvybswawrxaxk`** (conta nova do Evandro, plano free,
us-west-2) — `https://zkdeczpqvybswawrxaxk.supabase.co`.

Já aplicado/deployado:
- Schema multi-tenant (`0001_saas_multi_tenant.sql`) via Management API
- Edge Functions `meta-oauth`, `meta-sync`, `meta-creative`
- Auth: confirmação de e-mail **desligada** (facilita testes — religar
  antes de vender: Management API `mailer_autoconfirm: false`),
  anonymous sign-in desligado
- `.env.local` aponta para o projeto novo (`VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` + `SUPABASE_ACCESS_TOKEN` da conta nova)

Signup testado ao vivo: cria usuário + workspace automaticamente
(trigger `handle_new_user`).

> Free tier: projeto pausa após ~1 semana sem uso (Restore no dashboard).
> Para produção: upgrade Pro no projeto.

Para futuras mudanças de schema:
```bash
# rodar SQL novo no projeto (sem senha do banco, via Management API)
# ou: supabase link --project-ref zkdeczpqvybswawrxaxk && supabase db push
supabase functions deploy meta-oauth meta-sync meta-creative \
  --project-ref zkdeczpqvybswawrxaxk --use-api
```

## 2. App da Meta (developers.facebook.com)

Um único app do SaaS serve todos os clientes — cada cliente faz login
com o Facebook DELE e escolhe a conta de anúncios DELE.

1. **Criar app** → tipo **Business**.
2. Adicionar o produto **Facebook Login for Business**.
3. Em *Facebook Login → Settings → Valid OAuth Redirect URIs*:
   - `http://localhost:5601/meta/callback` (dev)
   - `https://SEU-DOMINIO.com/meta/callback` (produção)
4. Copiar **App ID** → `VITE_META_APP_ID` no `.env.local` (e na Vercel).
5. Copiar **App Secret** → **NUNCA no frontend**. Vai nos secrets do Supabase:
   ```bash
   supabase secrets set META_APP_ID=xxx META_APP_SECRET=yyy
   ```
6. Permissões usadas: `ads_read` + `business_management`.

**Modo de desenvolvimento**: o OAuth funciona imediatamente para
administradores/testers do app (adicione seu usuário e o de clientes
beta em *App Roles*). Para vender para o público geral é preciso:
- **App Review** das permissões `ads_read` e `business_management`
  (gravar um screencast do fluxo de conexão);
- **Business Verification** da sua empresa no Meta Business Manager.

## 3. Rodar

```bash
npm install
npm run dev   # porta 5601 no launch.json do Claude (ou 5173 padrão)
```

## 4. Fluxo multi-tenant (como funciona)

- Signup cria o usuário e um **workspace** (trigger `handle_new_user`).
- `current_workspace_id()` resolve o workspace pelo JWT → todo o RLS e
  todas as RPCs filtram por workspace sem o frontend precisar passar id.
- **Conexões** → OAuth Facebook → Edge Function `meta-oauth` troca o code
  por token longo (~60 dias) e guarda em `meta_connection_secrets`
  (tabela sem policy de leitura — só service_role).
- `meta-sync` / `meta-creative` resolvem o workspace pelo JWT e usam o
  token do PRÓPRIO cliente (`_shared/tenant.ts`).
- Token expira em ~60 dias → conexão marca `status='error'` e a UI pede
  reconexão.

## 5. Pendências conhecidas (pós-v1)

- Functions ainda single-tenant (não deployar por enquanto): `ai-analyze`,
  `classify-creative`, `classify-batch`, `save-media`, `restore-media`,
  `sync-ad-status`, `transcribe`. A classificação automática falha
  silenciosamente sem elas (o hook marca como "tentado" e segue).
- GA4: sub-aba oculta no Dashboard até portar o OAuth Google por workspace.
- Billing (Stripe) — entra quando houver primeiro cliente.
- Renovação automática do token Meta (hoje: reconectar a cada ~60 dias).
