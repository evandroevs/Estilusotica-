/**
 * buildDeckHTML — monta uma apresentação HTML autônoma (dark, accent lime)
 * a partir do deck gerado pela IA. Abre em nova aba; navega por ←/→ ou clique;
 * botão "Salvar PDF" usa a impressão do navegador (1 slide por página).
 */

const esc = (s) =>
  (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// **negrito** → <strong>
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

export function buildDeckHTML(deck) {
  const titulo = deck?.titulo ?? "Relatório GA4";
  const periodo = deck?.periodo ?? "";
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];

  const capa = `
    <section class="slide capa">
      <div class="badge">GA4 · Estilusótica</div>
      <h1>${inline(titulo)}</h1>
      ${periodo ? `<p class="periodo">${esc(periodo)}</p>` : ""}
      <p class="data">${new Date().toLocaleDateString("pt-BR")}</p>
    </section>`;

  const corpo = slides.map((s, i) => `
    <section class="slide">
      <div class="num">${i + 1} / ${slides.length}</div>
      <h2>${inline(s?.titulo ?? "")}</h2>
      ${s?.destaque ? `<div class="destaque"><span class="valor">${esc(s.destaque.valor ?? "")}</span><span class="label">${esc(s.destaque.label ?? "")}</span></div>` : ""}
      <ul>${(Array.isArray(s?.bullets) ? s.bullets : []).map((b) => `<li>${inline(b)}</li>`).join("")}</ul>
    </section>`).join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  :root{--bg:#0F0F12;--card:#26262D;--bd:#34343C;--txt:#E6E6EC;--muted:#9CA3AF;--accent:#C8FF00;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--txt);font-family:Inter,system-ui,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .toolbar{position:fixed;top:12px;right:12px;display:flex;gap:8px;z-index:50}
  .toolbar button{background:var(--card);border:1px solid var(--bd);color:var(--txt);padding:8px 14px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer}
  .toolbar .pdf{background:var(--accent);color:#000;border-color:var(--accent)}
  .deck{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory}
  .slide{min-height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:8vh 10vw;position:relative;border-bottom:1px solid var(--bd)}
  .slide h2{font-size:34px;font-weight:800;margin-bottom:24px;color:#fff;border-left:5px solid var(--accent);padding-left:16px}
  .slide ul{list-style:none;display:flex;flex-direction:column;gap:14px;max-width:900px}
  .slide li{font-size:19px;line-height:1.5;color:var(--txt);padding-left:24px;position:relative}
  .slide li:before{content:"";position:absolute;left:0;top:11px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
  .slide strong{color:var(--accent);font-weight:700}
  .num{position:absolute;top:6vh;right:10vw;color:var(--muted);font-size:13px}
  .destaque{display:inline-flex;flex-direction:column;background:rgba(200,255,0,.08);border:1px solid rgba(200,255,0,.3);border-radius:16px;padding:18px 28px;margin-bottom:24px;align-self:flex-start}
  .destaque .valor{font-size:40px;font-weight:800;color:var(--accent);line-height:1}
  .destaque .label{font-size:14px;color:var(--muted);margin-top:6px}
  .capa{align-items:flex-start;justify-content:center;background:radial-gradient(120% 80% at 0% 0%,rgba(200,255,0,.10),transparent 60%)}
  .capa .badge{font-size:13px;font-weight:700;color:var(--accent);letter-spacing:.5px;margin-bottom:20px}
  .capa h1{font-size:54px;font-weight:900;color:#fff;line-height:1.05;max-width:1000px}
  .capa .periodo{font-size:22px;color:var(--muted);margin-top:18px}
  .capa .data{font-size:14px;color:#55555F;margin-top:8px}
  @media print{
    @page{size:landscape;margin:0}
    .toolbar{display:none}
    .deck{height:auto;overflow:visible}
    .slide{min-height:100vh;page-break-after:always;border:none}
  }
</style></head>
<body>
  <div class="toolbar">
    <button onclick="nav(-1)">←</button>
    <button onclick="nav(1)">→</button>
    <button class="pdf" onclick="window.print()">Salvar PDF</button>
  </div>
  <div class="deck" id="deck">${capa}${corpo}</div>
  <script>
    var slides=[].slice.call(document.querySelectorAll('.slide'));var cur=0;
    function go(i){cur=Math.max(0,Math.min(slides.length-1,i));slides[cur].scrollIntoView({behavior:'smooth'});}
    function nav(d){go(cur+d);}
    document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown'){nav(1);}if(e.key==='ArrowLeft'||e.key==='PageUp'){nav(-1);}});
  </script>
</body></html>`;
}

/** Abre o deck numa nova aba (blob URL). */
export function openDeck(deck) {
  const html = buildDeckHTML(deck);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank");
  if (!w) { URL.revokeObjectURL(url); throw new Error("Popup bloqueado — libere popups para abrir a apresentação."); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
