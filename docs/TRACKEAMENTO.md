# Trackeamento — leads do WhatsApp → venda na loja

Aba do Dashboard usada pelos **vendedores**: cada conversa iniciada no
WhatsApp vira um card; o vendedor só confirma a venda (valor + foto da NF)
ou marca "não comprou" com um motivo. Meta: registrar uma venda em <10s.

## Peças

- **Tabela** `public.leads` (migration `0006`) — RLS por workspace (loja).
  Status: `em_atendimento` · `aguardando` · `vendido` · `nao_comprou`.
- **Storage** bucket `notas-fiscais` (público) — fotos das notas.
- **UI** `src/pages/Dashboard/Trackeamento.jsx` — KPIs do dia, filtros por
  status, drawer do lead com Confirmar Venda / Não Comprou. Realtime ligado
  (`supabase_realtime`): lead novo aparece sem recarregar a página.
- **Edge Function** `lead-webhook` — porta de entrada automática dos leads.
- Leads de exemplo (migration `0007`): `delete from public.leads where anuncio = 'exemplo';`

## Ligando o WhatsApp (automação externa)

Qualquer automação (webhook do WhatsApp Business, n8n, Zapier, Make…)
posta o lead assim:

```bash
curl -X POST https://zkdeczpqvybswawrxaxk.supabase.co/functions/v1/lead-webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $LEAD_WEBHOOK_SECRET" \
  -d '{
    "loja": "otica",                  # ou "select" (ou workspace_id direto)
    "nome": "Maria Silva",
    "telefone": "(41) 99912-3456",
    "origem": "meta",                 # meta | google | outro
    "campanha": "Mensagens - Óculos de Grau",
    "anuncio": "Criativo 03",
    "vendedor": "Fulano"              # opcional
  }'
```

> **Pendente**: definir o secret uma única vez —
> `supabase secrets set LEAD_WEBHOOK_SECRET=<valor> --project-ref zkdeczpqvybswawrxaxk`
> Sem ele a function responde 401 para tudo (seguro por padrão).

Para capturar campanha/anúncio de origem do clique, use os parâmetros de
referral do WhatsApp (ctwa_clid / referral no webhook do WhatsApp Business
API) — o payload do webhook da Meta traz `referral.source_id` (anúncio) e
`referral.headline`, que a automação mapeia para `campanha`/`anuncio`.
