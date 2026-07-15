/**
 * URLs do bucket público "creatives" no Supabase Storage.
 * O bucket é público: qualquer pessoa com a URL vê/baixa sem login.
 */

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/creatives`;

/** URL pública para exibir a mídia (img/video src). */
export function publicMediaUrl(storagePath) {
  return `${BASE}/${storagePath}`;
}

/** URL que força download com nome de arquivo amigável. */
export function downloadMediaUrl(storagePath, nome) {
  const fname = (nome ?? "criativo")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, 80)
    .trim() || "criativo";
  return `${BASE}/${storagePath}?download=${encodeURIComponent(fname)}`;
}

/**
 * Baixa uma URL qualquer (ex.: mídia da Meta ainda não salva no Storage).
 * Tenta via blob (nome de arquivo correto); se o CORS bloquear, abre em nova aba.
 */
export async function downloadExternalUrl(url, nome, ext) {
  const fname = `${(nome ?? "criativo").replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 80).trim() || "criativo"}.${ext}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
