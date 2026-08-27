# Trackeamento — do anúncio ao balcão, e de volta para a Meta

O problema que isto resolve: o cliente vê o anúncio, chama no WhatsApp e vai
comprar **na loja física**. A Meta nunca fica sabendo que a venda aconteceu, e
sem esse retorno a campanha otimiza no escuro — ela só enxerga "conversas
iniciadas", não faturamento.

O ciclo completo:

```
anúncio click-to-WhatsApp
        │  a Meta injeta o ctwa_clid na primeira mensagem
        ▼
whatsapp-webhook ──► lead salvo COM o ctwa_clid
        │
        ▼
vendedor tira foto da ordem de serviço
        │  nf-match: IA lê cliente/produto/valor e acha o lead
        ▼
venda confirmada no lead
        │
        ▼
meta-capi-purchase ──► Purchase na Conversions API, com o ctwa_clid
        │
        ▼
a Meta credita a venda ao anúncio exato que a gerou
```

> **O `ctwa_clid` é o coração disso.** É o ID daquele clique específico. Se ele
> não for capturado na primeira mensagem, não existe forma de recuperar depois:
> a venda até chega à Meta pelo telefone hasheado, mas sem apontar o criativo.

## Peças

| Peça | Arquivo | O que faz |
|---|---|---|
| Tabela `leads` | `migrations/0006`, `0011` | Lead + atribuição + rastro do envio |
| `meta_capi_connections` | `migrations/0011` | Dataset, WABA e número por loja |
| `meta_capi_secrets` | `migrations/0011` | Token (sem RLS: só service_role) |
| `whatsapp-webhook` | `functions/whatsapp-webhook` | Recebe mensagens e captura o ctwa_clid |
| `lead-webhook` | `functions/lead-webhook` | Entrada alternativa (n8n/Zapier) |
| `nf-match` | `functions/nf-match` | IA lê a ordem e cruza com os leads |
| `meta-capi-purchase` | `functions/meta-capi-purchase` | Manda o Purchase para a Meta |
| `meta-capi-config` | `functions/meta-capi-config` | Salva/testa a config pela tela |
| Tela do vendedor | `src/pages/Trackeamento` | Foto → venda → Meta avisada |
| Tela de config | `src/pages/Conexoes/TrackeamentoCard.jsx` | Onde tudo é ligado |

### Por que a venda nunca é contada duas vezes

O `event_id` enviado à Meta é `venda-{id do lead}` — derivado do lead, não do
momento do envio. Reenviar o mesmo lead (botão "Enviar para a Meta agora", lote
de pendentes, clique duplo) resulta no **mesmo** `event_id`, e a Meta deduplica.

---

# Passo a passo da configuração

Tudo abaixo depende de credenciais da Meta — nada disso pode ser feito por
código. A ordem importa.

## 1. Aplicar a migration

Pelo SQL Editor do Supabase (o CLI local está com credenciais vencidas):

`https://supabase.com/dashboard/project/zkdeczpqvybswawrxaxk/sql/new`

Cole o conteúdo de `supabase/migrations/0011_trackeamento_meta_capi.sql`.

> A migration renomeia `leads.nota_fiscal_url` para `documento_url` (a foto pode
> ser ordem de serviço, nota ou comprovante) e é idempotente — rodar duas vezes
> não quebra nada.

## 2. Deployar as Edge Functions

```bash
supabase functions deploy meta-capi-purchase --project-ref zkdeczpqvybswawrxaxk
supabase functions deploy meta-capi-config   --project-ref zkdeczpqvybswawrxaxk
supabase functions deploy nf-match           --project-ref zkdeczpqvybswawrxaxk
supabase functions deploy lead-webhook       --project-ref zkdeczpqvybswawrxaxk
supabase functions deploy whatsapp-webhook   --project-ref zkdeczpqvybswawrxaxk --no-verify-jwt
```

O `--no-verify-jwt` do `whatsapp-webhook` é obrigatório: quem chama é a Meta, que
não manda JWT nenhum. A autenticidade vem da assinatura `X-Hub-Signature-256`,
conferida dentro da function.

## 3. Dataset da Meta (onde a venda é registrada)

- **Estilus Ótica** — já existe: `504762905373298` ("Estilus Ótica - Pixel da
  Meta"), ativo e recebendo eventos de servidor.
- **Estilus Select** — **não existe nenhum dataset** em nenhuma das contas.
  Criar em Events Manager → Conectar fontes de dados → Web, e anotar o ID.

## 4. Token do system user

Business Settings → **Usuários do sistema** → criar/usar um usuário do sistema →
**Gerar novo token**, com:

- App: o app da Meta usado pela plataforma
- Permissões: `ads_management`, `business_management`, `whatsapp_business_messaging`
- Acesso ao **dataset** da loja (atribuir o ativo ao usuário do sistema)

Token de system user não expira — por isso ele, e não o token de 60 dias do OAuth.

## 5. WhatsApp Business API

Cada loja precisa do **seu** número conectado à Cloud API.

No painel do app → WhatsApp → Configuração da API, anote:

- **WhatsApp Business Account ID** (WABA)
- **ID do número de telefone** (`phone_number_id`) — é o ID, não o número

Depois, em WhatsApp → **Configuration** → Webhook:

- **Callback URL**: `https://zkdeczpqvybswawrxaxk.supabase.co/functions/v1/whatsapp-webhook`
- **Verify token**: o mesmo valor que você puser em `WHATSAPP_VERIFY_TOKEN`
- **Campos assinados**: marque **`messages`** (sem isso o ctwa_clid não chega)

## 6. Secrets no Supabase

```bash
supabase secrets set \
  WHATSAPP_VERIFY_TOKEN=<string inventada por você, igual à do painel> \
  WHATSAPP_APP_SECRET=<App Secret, em Configurações do app → Básico> \
  --project-ref zkdeczpqvybswawrxaxk
```

Confira também os que já deveriam existir:

- `ANTHROPIC_API_KEY` — sem ela a IA não lê a ordem de serviço e o vendedor cai
  no fluxo manual (a tela avisa quando é o caso)
- `LEAD_WEBHOOK_SECRET` — só se for usar a entrada via n8n/Zapier

## 7. Ligar na tela

Em **Conexões → Trackeamento da loja física**, para **cada loja** (troque de loja
no seletor do topo):

| Campo | De onde vem |
|---|---|
| ID do dataset | passo 3 |
| WABA ID | passo 5 |
| ID do número de telefone | passo 5 |
| Token do system user | passo 4 |
| Código de teste | Events Manager → Testar eventos |

Salve e clique em **Enviar evento de teste**.

> Preencha o **test_event_code** enquanto valida. Com ele, os eventos aparecem
> só na aba "Testar eventos" e **não contam na campanha**. Apague o campo quando
> for para valer — se esquecer, a Meta nunca vai receber as vendas de verdade.

## 8. Conferir de ponta a ponta

1. Clique num anúncio click-to-WhatsApp seu, pelo celular, e mande uma mensagem.
2. O lead deve aparecer sozinho no Trackeamento, com o ícone de megafone
   (= clique do anúncio identificado).
3. Abra o lead → confirme uma venda com valor.
4. O lead deve passar para "Meta avisada"; em Events Manager → Testar eventos,
   o `Purchase` aparece com `action_source: business_messaging`.

---

## Entrada alternativa: n8n / Zapier

Se a automação passar por um intermediário, ela pode postar direto:

```bash
curl -X POST https://zkdeczpqvybswawrxaxk.supabase.co/functions/v1/lead-webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $LEAD_WEBHOOK_SECRET" \
  -d '{
    "loja": "otica",
    "nome": "Maria Silva",
    "telefone": "(41) 99912-3456",
    "origem": "meta",
    "campanha": "Mensagens - Óculos de Grau",
    "anuncio": "Criativo 03",
    "ctwa_clid": "ARAxxxxxxxxxxxx"
  }'
```

**Mande sempre o `ctwa_clid`** — no webhook do WhatsApp ele está em
`entry[].changes[].value.messages[].referral.ctwa_clid`, e só vem na **primeira**
mensagem da conversa.

## Detalhes de comportamento

- **Baixa automática** só acontece quando o telefone da ordem bate com **um**
  lead ainda aberto. Se casou pelo nome, ou o lead já estava vendido, o vendedor
  confirma na mão — evita creditar venda ao cliente errado.
- **Janela de busca**: 90 dias. Cliente marcado como "não comprou" que volta
  depois é encontrado.
- **Venda avulsa**: quem não veio de anúncio entra com `avulsa = true`, conta no
  faturamento da loja e **nunca** é enviada à Meta. Sinalizar compra que a
  campanha não gerou envenena o otimizador.
- **Mensagem sem referral** só abre lead novo se não houver conversa daquele
  telefone nos últimos 30 dias — senão cada mensagem viraria um card.
- **Falha no envio** não derruba a venda: ela fica registrada com
  `meta_status = 'erro'` e aparece no aviso amarelo do topo, com botão de
  reenvio em lote.

## Limpar os leads de exemplo

Os leads atuais são fictícios (migration `0007`):

```sql
delete from public.leads where anuncio = 'exemplo';
```
