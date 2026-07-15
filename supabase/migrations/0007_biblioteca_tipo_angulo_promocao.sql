-- =============================================================
-- 0007 — Tipo do criativo (Vídeo/Arte) + ângulo "Promoção"
-- =============================================================

-- Tipo do criativo na biblioteca: Vídeo ou Arte (estático)
alter table public.biblioteca
  add column if not exists tipo text check (tipo in ('Vídeo', 'Arte'));

comment on column public.biblioteca.tipo is 'Tipo do criativo: Vídeo ou Arte (estático).';

-- Adiciona o ângulo "Promoção" em todas as linhas config.angulos
-- (global e por usuário) que ainda não o possuem
update public.config
set valor = valor || '[{
  "id": "a8",
  "nome": "Promoção",
  "psicologia": "Oferta concreta — desconto, bônus ou condição especial com vantagem clara",
  "nivel": "Consciente da Oferta",
  "is_default": true
}]'::jsonb
where chave = 'angulos'
  and not exists (
    select 1
    from jsonb_array_elements(valor) elem
    where elem->>'nome' = 'Promoção'
  );
