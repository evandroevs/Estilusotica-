/**
 * Loja ativa (workspace) — escolhida no seletor do topo da sidebar.
 *
 * O id fica no localStorage e viaja em TODA request do Supabase no header
 * `x-workspace-id` (ver lib/supabase.js). O backend valida se o usuário é
 * membro da loja pedida — mandar um id qualquer não dá acesso a nada.
 *
 * Sem nada salvo, o backend cai na primeira loja do usuário.
 */

const KEY = "loja-ativa";

export function getActiveWorkspaceId() {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null; // localStorage bloqueado (modo privado, iframe)
  }
}

/**
 * Troca de loja. Recarrega a página de propósito: o cliente Supabase é
 * criado com o header da loja e o cache do React Query morre junto —
 * assim nenhum dado da loja anterior sobrevive à troca.
 */
export function switchWorkspace(id) {
  if (!id || id === getActiveWorkspaceId()) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* sem localStorage a troca não persiste — segue para o reload mesmo assim */
  }
  window.location.assign("/");
}
