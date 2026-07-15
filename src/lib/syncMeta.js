/**
 * syncMetaRange — invoca a Edge Function meta-sync em sub-janelas sequenciais.
 *
 * Pulls diários (time_increment=1) de janelas longas estouram o limite de
 * execução da função (150s) e o rate limit da Meta. Por isso quebramos em
 * trechos de poucos dias, com uma pequena pausa entre eles.
 */
import { supabase } from "./supabase";

function addDaysStr(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 7 dias por chunk: 10 dias chegou a levar ~149s, raspando no teto de 150s da Edge Function
export async function syncMetaRange(start, end, { chunkDays = 7, onProgress } = {}) {
  let cursor = start;
  let synced = 0;
  let days = 0;
  const errors = [];

  while (cursor <= end) {
    let until = addDaysStr(cursor, chunkDays - 1);
    if (until > end) until = end;

    const { data, error } = await supabase.functions.invoke("meta-sync", {
      body: { date_start: cursor, date_stop: until },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    synced += data?.synced ?? 0;
    days   += data?.days ?? 0;
    if (Array.isArray(data?.errors)) errors.push(...data.errors);
    onProgress?.({ from: cursor, to: until });

    cursor = addDaysStr(until, 1);
    if (cursor <= end) await sleep(800); // alivia o rate limit da Meta entre chunks
  }

  return { synced, days, errors };
}
