/**
 * getVideoSource — resolve a URL reproduzível (source) de um vídeo da Meta.
 *
 * A Meta só devolve o campo `source` de vídeos de Página quando a consulta
 * usa o TOKEN DA PRÓPRIA PÁGINA dona do vídeo (com o token do sistema vem
 * HTTP 200 sem o campo). Estratégia:
 *   1. Pede source + from com o token do sistema (source raramente vem)
 *   2. Descobre a Página dona (from.id) e busca o token dela
 *   3. Repete a consulta do source com o token da Página
 *
 * Requer que o usuário do sistema tenha acesso às Páginas no Business
 * Manager e que o token tenha pages_read_engagement + pages_show_list.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export interface VideoSource {
  source: string | null;
  error: string | null;
}

/**
 * Campos do creative necessários para detectar vídeo em TODOS os formatos.
 * O video_id raiz só existe em criativos de vídeo simples; vídeos de post da
 * Página vêm em object_story_spec.video_data e criativos flexíveis/Advantage+
 * em asset_feed_spec.videos.
 */
export const CREATIVE_MEDIA_FIELDS =
  "thumbnail_url,image_url,video_id," +
  "object_story_spec{video_data{video_id}}," +
  "asset_feed_spec{videos{video_id}}";

export interface CreativeMediaFields {
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_story_spec?: { video_data?: { video_id?: string } };
  asset_feed_spec?: { videos?: Array<{ video_id?: string }> };
}

/** Extrai o video_id do creative em qualquer formato (null = é imagem/arte). */
export function extractVideoId(
  creative: CreativeMediaFields | null | undefined,
): string | null {
  if (!creative) return null;
  return creative.video_id ??
         creative.object_story_spec?.video_data?.video_id ??
         creative.asset_feed_spec?.videos?.[0]?.video_id ??
         null;
}

export async function getVideoSource(
  videoId: string,
  systemToken: string,
): Promise<VideoSource> {
  // 1. Tentativa direta + descoberta da Página dona
  const direct = await fetch(
    `${GRAPH}/${videoId}?fields=source,from&access_token=${systemToken}`,
  );
  const directData = await direct.json();

  if (directData.source) return { source: directData.source, error: null };

  if (directData.error) {
    return {
      source: null,
      error: directData.error.message ?? `Meta API ${direct.status}`,
    };
  }

  const pageId: string | undefined = directData.from?.id;
  if (!pageId) {
    return { source: null, error: "Vídeo sem Página dona identificável (campo from vazio)." };
  }

  // 2. Token da Página dona
  const pageResp = await fetch(
    `${GRAPH}/${pageId}?fields=access_token&access_token=${systemToken}`,
  );
  const pageData = await pageResp.json();
  const pageToken: string | undefined = pageData.access_token;

  if (!pageToken) {
    return {
      source: null,
      error: pageData.error?.message ??
        `Sem acesso ao token da Página ${directData.from?.name ?? pageId} — adicione a Página ao usuário do sistema no Business Manager.`,
    };
  }

  // 3. Source com o token da Página
  const finalResp = await fetch(
    `${GRAPH}/${videoId}?fields=source&access_token=${pageToken}`,
  );
  const finalData = await finalResp.json();

  if (finalData.source) return { source: finalData.source, error: null };

  return {
    source: null,
    error: finalData.error?.message ?? "Vídeo sem source mesmo com token da Página.",
  };
}
