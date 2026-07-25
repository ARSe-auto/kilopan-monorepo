#!/usr/bin/env node
// Panel de control y monitoreo — lee SOLO estado verificable (git, IMPLEMENTATION_PLAN.md,
// el log del último check.sh). Nunca "proceso vivo" como prueba de avance — ver
// docs/LECCION_RALPH.md. Diseñado para correr una vez o en loop (`--watch`).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PLAN = join(ROOT, "IMPLEMENTATION_PLAN.md");
const OUT_HTML = join(HERE, "index.html");
const OUT_JSON = join(HERE, "estado.json");
const CHECK_LOG = join(HERE, "ultimo-check.log");
const CHECK_ESTADO = join(HERE, "ultimo-check.estado");
const LOOP_PID = join(HERE, "loop.pid");

function sh(cmd, fallback = "") {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function leerPlan() {
  if (!existsSync(PLAN)) return { hitos: [], abiertos: 0, cerrados: 0 };
  const texto = readFileSync(PLAN, "utf8");
  const lineas = texto.split("\n");
  const hitos = [];
  let actual = null;
  const acRe = /^- \[( |x)\] \((P[0-9](?:-[A-Z]+)?)\)\s+(.*?)(?:\s+\[([A-Z0-9-]+)\])?$/;
  for (const linea of lineas) {
    const hitoMatch = linea.match(/^## (Hito .+|Endurecimiento transversal.*)/);
    if (hitoMatch) {
      actual = { titulo: hitoMatch[1], abiertos: 0, cerrados: 0, items: [] };
      hitos.push(actual);
      continue;
    }
    const m = linea.match(acRe);
    if (m && actual) {
      const cerrado = m[1] === "x";
      const [, , prioridad, descripcion, ac] = m;
      actual.items.push({ cerrado, prioridad, descripcion, ac: ac ?? "" });
      cerrado ? actual.cerrados++ : actual.abiertos++;
    }
  }
  const abiertos = hitos.reduce((s, h) => s + h.abiertos, 0);
  const cerrados = hitos.reduce((s, h) => s + h.cerrados, 0);
  return { hitos, abiertos, cerrados };
}

function leerGit() {
  if (!existsSync(join(ROOT, ".git"))) {
    return { commits: 0, ultimoCommit: null, minutosDesdeUltimo: null, ultimosMensajes: [] };
  }
  const commits = Number(sh("git rev-list --count HEAD", "0")) || 0;
  const ultimoIso = sh("git log -1 --format='%cI'", "");
  const ultimosMensajes = sh("git log -12 --format='%h|%cI|%s'", "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, fecha, ...resto] = l.split("|");
      return { hash, fecha, mensaje: resto.join("|") };
    });
  const minutos = ultimoIso ? Math.round((Date.now() - new Date(ultimoIso).getTime()) / 60000) : null;
  return { commits, ultimoCommit: ultimoIso, minutosDesdeUltimo: minutos, ultimosMensajes };
}

function leerCheck() {
  const estado = existsSync(CHECK_ESTADO) ? readFileSync(CHECK_ESTADO, "utf8").trim() : "sin-datos";
  const mtime = existsSync(CHECK_LOG) ? statSync(CHECK_LOG).mtime.toISOString() : null;
  const minutos = mtime ? Math.round((Date.now() - new Date(mtime).getTime()) / 60000) : null;
  return { estado, mtime, minutos };
}

function leerLoop() {
  if (!existsSync(LOOP_PID)) return { corriendo: false, pid: null };
  const pid = Number(readFileSync(LOOP_PID, "utf8").trim());
  if (!pid) return { corriendo: false, pid: null };
  try {
    process.kill(pid, 0); // no mata, solo prueba si existe
    return { corriendo: true, pid };
  } catch {
    return { corriendo: false, pid };
  }
}

function heuristicoCuelgue(git, loop) {
  // Regla explícita (se prueba contra el caso normal en test-panel.mjs):
  // el PROCESO vivo NUNCA basta solo. Solo se marca "posible cuelgue" si, ADEMÁS de
  // que el loop diga estar corriendo, no hay commits nuevos hace >30 min.
  if (!loop.corriendo) return { estado: "detenido", detalle: "el loop no está corriendo ahora mismo" };
  if (git.minutosDesdeUltimo === null) return { estado: "sin-datos", detalle: "sin commits todavía" };
  if (git.minutosDesdeUltimo > 30) {
    return {
      estado: "posible-cuelgue",
      detalle: `loop corriendo (pid ${loop.pid}) pero ${git.minutosDesdeUltimo} min sin commits nuevos`,
    };
  }
  return { estado: "avanzando", detalle: `último commit hace ${git.minutosDesdeUltimo} min` };
}

function pct(cerrados, total) {
  if (total === 0) return 0;
  return Math.round((cerrados / total) * 100);
}

function render(estado) {
  const { plan, git, check, loop, cuelgue, generadoEn } = estado;
  const total = plan.abiertos + plan.cerrados;
  const avance = pct(plan.cerrados, total);
  const colorEstadoCheck = check.estado === "verde" ? "#15803D" : check.estado === "rojo" ? "#B91C1C" : "#8A8377";
  const colorCuelgue =
    cuelgue.estado === "avanzando" ? "#15803D" : cuelgue.estado === "posible-cuelgue" ? "#B45309" : "#8A8377";

  const filasHitos = plan.hitos
    .map((h) => {
      const t = h.abiertos + h.cerrados;
      const p = pct(h.cerrados, t);
      return `<tr><td class="tp">${esc(h.titulo)}</td><td class="num">${h.cerrados}/${t}</td>
        <td><div class="bar"><div class="bar-fill" style="width:${p}%"></div></div></td>
        <td class="num">${p}%</td></tr>`;
    })
    .join("\n");

  const filasCommits = git.ultimosMensajes
    .map(
      (c) =>
        `<tr><td class="mono">${esc(c.hash)}</td><td>${esc(fechaCorta(c.fecha))}</td><td>${esc(c.mensaje)}</td></tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="30" />
<title>KiloPan — Panel de avance</title>
<style>
  :root{ --bg:#131110; --card:#1D1916; --ink:#F5EFE6; --dim:#B2A99C; --faint:#7E766A;
         --hair:rgba(245,239,230,.14); --accent:#E8722C; }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px clamp(16px,4vw,48px); }
  h1{ font-size:1.6rem; margin:0 0 4px; }
  .sub{ color:var(--dim); font-size:.9rem; margin-bottom:28px; }
  .grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:32px; }
  .card{ background:var(--card); border:1px solid var(--hair); border-radius:14px; padding:18px 20px; }
  .card .k{ font-size:.72rem; text-transform:uppercase; letter-spacing:.07em; color:var(--faint); margin-bottom:8px; }
  .card .v{ font-size:1.7rem; font-weight:700; font-variant-numeric:tabular-nums; }
  .card .v small{ font-size:.95rem; color:var(--dim); font-weight:500; }
  table{ width:100%; border-collapse:collapse; margin-bottom:32px; font-size:.9rem; }
  th{ text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); padding:8px 10px; border-bottom:1px solid var(--hair); }
  td{ padding:8px 10px; border-bottom:1px solid var(--hair); color:var(--dim); vertical-align:middle; }
  td.tp{ color:var(--ink); font-weight:600; }
  td.num{ font-variant-numeric:tabular-nums; color:var(--ink); }
  td.mono{ font-family:ui-monospace,Menlo,monospace; color:var(--faint); }
  .bar{ background:var(--hair); border-radius:100px; height:8px; width:140px; overflow:hidden; }
  .bar-fill{ background:var(--accent); height:100%; }
  .pill{ display:inline-block; padding:4px 10px; border-radius:100px; font-size:.78rem; font-weight:700; }
  h2{ font-size:1rem; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); margin:0 0 12px; }
  .note{ font-size:.8rem; color:var(--faint); margin-top:-20px; margin-bottom:28px; }
</style>
</head>
<body>
  <h1>KiloPan — panel de avance</h1>
  <div class="sub">Generado ${esc(generadoEn)} · se actualiza solo cada 30 s si lo dejas abierto</div>

  <div class="grid">
    <div class="card"><div class="k">Commits totales</div><div class="v">${git.commits}</div></div>
    <div class="card"><div class="k">ACs cerrados</div><div class="v">${plan.cerrados} <small>/ ${total}</small></div></div>
    <div class="card"><div class="k">Avance del plan</div><div class="v">${avance}%</div></div>
    <div class="card"><div class="k">Último check.sh</div><div class="v"><span class="pill" style="background:${colorEstadoCheck}22;color:${colorEstadoCheck}">${esc(check.estado)}</span></div></div>
    <div class="card"><div class="k">Señal del loop</div><div class="v"><span class="pill" style="background:${colorCuelgue}22;color:${colorCuelgue}">${esc(cuelgue.estado)}</span></div></div>
  </div>
  <p class="note">${esc(cuelgue.detalle)} — el conteo de commits y de ACs manda siempre sobre si el proceso está vivo (ver docs/LECCION_RALPH.md).</p>

  <h2>Avance por hito</h2>
  <table>
    <thead><tr><th>Hito</th><th>ACs</th><th>Barra</th><th>%</th></tr></thead>
    <tbody>${filasHitos || '<tr><td colspan="4">Sin hitos leídos de IMPLEMENTATION_PLAN.md todavía.</td></tr>'}</tbody>
  </table>

  <h2>Últimos commits</h2>
  <table>
    <thead><tr><th>Hash</th><th>Fecha</th><th>Mensaje</th></tr></thead>
    <tbody>${filasCommits || '<tr><td colspan="3">Sin commits todavía.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fechaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function main() {
  const plan = leerPlan();
  const git = leerGit();
  const check = leerCheck();
  const loop = leerLoop();
  const cuelgue = heuristicoCuelgue(git, loop);
  const generadoEn = new Date().toISOString();
  const estado = { plan, git, check, loop, cuelgue, generadoEn };

  writeFileSync(OUT_JSON, JSON.stringify(estado, null, 2));
  writeFileSync(OUT_HTML, render(estado));
  console.log(`panel: ${plan.cerrados}/${plan.abiertos + plan.cerrados} ACs · ${git.commits} commits · check=${check.estado} · loop=${cuelgue.estado}`);
  console.log(`panel: escrito en ${OUT_HTML}`);
}

main();
