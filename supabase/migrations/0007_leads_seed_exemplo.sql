-- ── Leads de exemplo (demonstração da aba Trackeamento) ──────────────────
-- Para limpar depois que o webhook do WhatsApp estiver ligado:
--   delete from public.leads where anuncio = 'exemplo';

with lojas as (
  select id as workspace_id from public.workspaces
)
insert into public.leads
  (workspace_id, nome, telefone, iniciado_em, origem, campanha, anuncio, status)
select l.workspace_id, d.nome, d.telefone, d.iniciado_em, d.origem, d.campanha, 'exemplo', d.status
  from lojas l
  cross join (values
    ('Maria Silva',    '(41) 99912-3456', now() - interval '25 minutes', 'meta',   'Mensagens - Óculos de Grau',  'em_atendimento'),
    ('João Pedro',     '(41) 98876-5432', now() - interval '1 hour',     'meta',   'Mensagens - Óculos de Grau',  'em_atendimento'),
    ('Ana Beatriz',    '(41) 99700-1122', now() - interval '3 hours',    'google', 'Search - Ótica Centro',       'aguardando'),
    ('Carlos Eduardo', '(41) 98455-7788', now() - interval '1 day',      'google', 'Search - Ótica Centro',       'em_atendimento'),
    ('Fernanda Souza', '(41) 99633-4455', now() - interval '2 days',     'meta',   'Mensagens - Lentes de Contato', 'em_atendimento')
  ) as d (nome, telefone, iniciado_em, origem, campanha, status);
