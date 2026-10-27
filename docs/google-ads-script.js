/**
 * Estilusótica — envio diário do Google Ads para a plataforma.
 *
 * Cole este script em UMA conta do Google Ads:
 *   Ferramentas e configurações → Ações em massa → Scripts → +
 *
 * Depois: Autorizar → Visualizar (para testar) → Salvar → agendar "Diariamente".
 *
 * Por que script e não a API: o Google Ads Script já roda autenticado dentro
 * da conta. Não precisa de developer token nem de aprovação — que é o que
 * está travando a integração oficial.
 *
 * Reenviar o mesmo dia é de propósito: conversão no Google é retroativa, o
 * número de ontem ainda muda depois. A plataforma sobrescreve pela chave
 * (loja, data, conta, campanha), então rodar duas vezes não duplica nada.
 */

// ── Configuração ────────────────────────────────────────────────────────────
var WEBHOOK_URL = 'https://zkdeczpqvybswawrxaxk.supabase.co/functions/v1/google-ads-webhook';
var SECRET      = 'COLE_AQUI_O_GOOGLE_ADS_WEBHOOK_SECRET';

// Quantos dias para trás reenviar a cada execução.
// 14 cobre a janela em que o Google ainda ajusta conversões.
var DIAS = 14;

// Mandar campanhas sem nenhuma impressão no período? Não, só polui o banco.
var INCLUIR_ZERADAS = false;
// ────────────────────────────────────────────────────────────────────────────


function main() {
  var contaId = AdsApp.currentAccount().getCustomerId().replace(/\D/g, '');
  var linhas  = buscarLinhas();

  if (!linhas.length) {
    Logger.log('Nada para enviar na conta ' + contaId + '.');
    return;
  }

  // Lotes para não estourar o limite de tamanho da requisição em contas grandes.
  var LOTE = 500;
  var enviadas = 0;

  for (var i = 0; i < linhas.length; i += LOTE) {
    var lote = linhas.slice(i, i + LOTE);
    var resp = postar({ account_id: contaId, rows: lote });

    if (resp.getResponseCode() !== 200) {
      // Falha alta e visível: script que falha calado some do radar e o
      // dashboard congela sem ninguém perceber.
      throw new Error(
        'Plataforma recusou (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText()
      );
    }
    enviadas += lote.length;
  }

  Logger.log('Conta ' + contaId + ': ' + enviadas + ' linha(s) enviada(s), ' + DIAS + ' dias.');
}


/** Métricas por campanha e por dia, direto do relatório da conta. */
function buscarLinhas() {
  var query =
    'SELECT campaign.id, campaign.name, segments.date, ' +
    '       metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    '       metrics.conversions, metrics.conversions_value ' +
    'FROM campaign ' +
    'WHERE segments.date >= "' + desde(DIAS) + '" AND segments.date <= "' + hoje() + '"';

  var linhas = [];
  var rows = AdsApp.report(query).rows();

  while (rows.hasNext()) {
    var r = rows.next();
    var impressoes = Number(r['metrics.impressions']) || 0;
    if (!INCLUIR_ZERADAS && impressoes === 0) continue;

    linhas.push({
      date:             r['segments.date'],
      campaign_id:      String(r['campaign.id']),
      campaign_name:    r['campaign.name'],
      impressions:      impressoes,
      clicks:           Number(r['metrics.clicks']) || 0,
      // A API devolve custo em micros: 25190000 = R$ 25,19.
      cost:             (Number(r['metrics.cost_micros']) || 0) / 1000000,
      conversions:      Number(r['metrics.conversions']) || 0,
      conversion_value: Number(r['metrics.conversions_value']) || 0
    });
  }
  return linhas;
}


function postar(payload) {
  return UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}


/** Datas no fuso da conta — senão vira o dia antes da hora e falta o último dia. */
function hoje() {
  return Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function desde(dias) {
  var d = new Date();
  d.setDate(d.getDate() - dias);
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}
