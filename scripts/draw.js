/* Automatische Wochen-Auslosung für alle Gruppen.
   Läuft per GitHub Actions montags und schreibt fällige Auslosungen
   direkt in die Firebase Realtime Database (REST-API).
   Die Zufallslogik ist identisch mit der App (deterministisch aus
   Gruppencode + Kalenderwoche), daher gibt es nie widersprüchliche
   Ergebnisse, selbst wenn App und Skript gleichzeitig auslösen. */

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error('Fehler: Umgebungsvariable DB_URL fehlt (Firebase databaseURL).');
  process.exit(1);
}

/* ---- Zeitrechnung in deutscher Zeitzone ---- */
function berlinNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return {
    y: +get('year'), m: +get('month'), d: +get('day'),
    hh: +get('hour'), mm: +get('minute'),
    weekday: get('weekday') // Mon, Tue, ...
  };
}

/* Letzter fälliger Stichtag (Montag 10:00 Berlin) als periodId YYYY-MM-DD */
function duePeriodId() {
  const n = berlinNow();
  const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(n.weekday);
  // Datum des Montags dieser Woche (in Berlin-Kalendertagen)
  const base = new Date(Date.UTC(n.y, n.m - 1, n.d));
  base.setUTCDate(base.getUTCDate() - dayIdx);
  // Vor Montag 10:00? Dann gilt noch die Vorwoche.
  const beforeCutoff = dayIdx === 0 && (n.hh < 10);
  if (beforeCutoff) base.setUTCDate(base.getUTCDate() - 7);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* Stichtag (Montag 10:00 Berlin) als Zeitstempel, Sommer-/Winterzeit-sicher */
function cutoffEpoch(pid) {
  const probe = new Date(pid + 'T12:00:00Z');
  const hh = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe);
  const offset = hh - 12; // 1 = MEZ, 2 = MESZ
  return Date.parse(pid + 'T10:00:00+0' + offset + ':00');
}

/* ---- identische Zufallslogik wie in der App ---- */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const pid = duePeriodId();
  console.log('Fälliger Stichtag (Berlin):', pid);

  const res = await fetch(`${DB_URL}/groups.json`);
  if (!res.ok) { console.error('Datenbank nicht erreichbar:', res.status); process.exit(1); }
  const groups = await res.json();
  if (!groups) { console.log('Keine Gruppen vorhanden – nichts zu tun.'); return; }

  let drawn = 0, skipped = 0;
  for (const [code, g] of Object.entries(groups)) {
    const draws = Object.values(g.draws || {});
    if (draws.some(d => d.periodId === pid)) { skipped++; continue; }
    if (g.createdAt && g.createdAt > cutoffEpoch(pid)) { skipped++; continue; }

    const words = Object.values(g.words || {});
    const active = words.filter(w => !w.drawn).sort((a, b) => a.id.localeCompare(b.id));
    if (active.length === 0) { skipped++; continue; }

    const rnd = mulberry32(xmur3(code + '|' + pid)());
    const pick = active[Math.floor(rnd() * active.length)];
    const did = 'd_' + pid;
    const upd = {
      [`words/${pick.id}/drawn`]: pid,
      [`draws/${did}`]: { periodId: pid, wordId: pick.id, text: pick.text, by: pick.userName, at: Date.now() }
    };
    const w = await fetch(`${DB_URL}/groups/${code}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upd)
    });
    if (w.ok) { drawn++; console.log(`[${code}] ausgelost: "${pick.text}" (von ${pick.userName})`); }
    else { console.error(`[${code}] Schreiben fehlgeschlagen:`, w.status); }
  }
  console.log(`Fertig: ${drawn} ausgelost, ${skipped} übersprungen (schon ausgelost oder Lostopf leer).`);
}

main().catch(e => { console.error(e); process.exit(1); });
