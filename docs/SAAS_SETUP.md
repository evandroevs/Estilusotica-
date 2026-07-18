# Setup do SaaS — Estilusótica Dash

O que precisa existir para o SaaS funcionar de ponta a ponta:
login → conectar Meta Ads do cliente → dashboard com as métricas dele.

## 1. Projeto Supabase (backend)

> ⚠️ **Bloqueio atual**: a criação de projetos está travada por faturas
> vencidas na organização "lucascaricatti-del's Org". Regularize em
> Dashboard → Organization → Invoices e rode o passo abaixo.

```bash
# cria o projeto (org EVANDRO) — a senha do banco já está em .env.local
supabase projects create estilusotica-saas \
  --org-id xkezjdsiblzomiienryq --region sa-east-1 \
  --db-password "$SUPABASE_DB_PASSWORD"

# linka o repo e aplica o schema multi-tenant
supabase link --project-ref <REF-DO-PROJETO-NOVO>
supabase db push

# deploya as functions multi-tenant
supabase functions deploy meta-oauth meta-sync meta-creative
```

Depois copie de **Settings → API** para o `.env.local`:
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (sb_publishable_...).

Em **Authentication → Providers → Email**: decidir se exige confirmação
de e-mail (a tela de login já trata os dois casos). Anonymous sign-in
fica **desligado** (padrão) — o SaaS usa login real.

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
