import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { moodOf } from "../composer/moods";
import { feelingsOf } from "../composer/MoodTrio";
import { RichText } from "../components/RichText";
import type { Entry, Person } from "../data";
import { todayInputValue } from "../lib/format";
import { lightLabel, skyKind, skyLabel, sleepOf } from "./context";
import { dayOf, longDay, monthTitle } from "./model";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** El cuerpo con sus negritas, resaltados y tachados, como HTML. */
function richHtml(text: string, names: string[]) {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(createElement(RichText, { text, names })));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

const year = (date: string) => date.slice(0, 4);

function metaOf(e: Entry) {
  const out: string[] = [];
  const c = e.details.ctx;
  if (typeof c?.hour === "number")
    out.push(`${String(c.hour).padStart(2, "0")}:00`);
  if (c?.light) out.push(lightLabel[c.light].toLowerCase());
  const sky = skyKind(c?.weather);
  if (sky)
    out.push(
      skyLabel[sky].toLowerCase() +
        (typeof c?.temp === "number" ? ` ${c.temp}°` : ""),
    );
  const { place, where } = e.details;
  if (place) out.push(place);
  if (where && where !== place) out.push(`escrito desde ${where}`);
  const sleep = sleepOf(e);
  if (e.details.sleep && sleep) out.push(`dormí ${sleep}`);
  if (e.details.exercise) out.push("hice ejercicio");
  return out;
}

const STYLE = `
@page { size: A4; margin: 22mm 20mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #2b2620; font: 400 11.5pt/1.65 "Newsreader", Georgia, "Times New Roman", serif; }
.cover { height: 230mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover small { font: 700 8pt/1 system-ui, sans-serif; letter-spacing: 2px; text-transform: uppercase; color: #b4823a; }
.cover h1 { margin: 10px 0 6px; font-weight: 500; font-size: 38pt; letter-spacing: -0.5px; }
.cover p { margin: 0; font: 400 11pt/1.5 system-ui, sans-serif; color: #8a8173; }
h2.month { margin: 0 0 14px; padding-bottom: 6px; border-bottom: 1px solid #ece5d6; font-weight: 500; font-size: 17pt; page-break-after: avoid; }
h2.month:not(:first-of-type) { margin-top: 26px; }
article { margin: 0 0 22px; page-break-inside: avoid; }
article + article { padding-top: 16px; border-top: 1px dashed #ece5d6; }
.date { font: 600 8.5pt/1.3 system-ui, sans-serif; letter-spacing: .4px; color: #8a8173; }
.date b { color: #6e4d1c; }
.meta { margin-top: 2px; font: 400 8.5pt/1.3 system-ui, sans-serif; color: #a69d8e; }
.moods { margin-top: 6px; font: 500 9pt/1.3 system-ui, sans-serif; color: #6e4d1c; }
.moods span { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 99px; background: #f6ecd8; }
h3 { margin: 8px 0 4px; font-weight: 500; font-size: 15pt; line-height: 1.3; }
.body { white-space: pre-wrap; text-align: justify; hyphens: auto; }
.body mark { background: #fbeec4; color: inherit; }
.photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.photos img { width: 48mm; height: 36mm; object-fit: cover; border-radius: 3mm; }
.foot { margin-top: 8px; font: 400 8.5pt/1.4 system-ui, sans-serif; color: #8a8173; }
.foot i { font-style: normal; color: #6e4d1c; }
.end { margin-top: 30px; text-align: center; font: 400 8pt system-ui, sans-serif; color: #b3ab9c; }
`;

/**
 * Exporta entradas del diario a PDF con el diálogo de impresión del navegador («Guardar como
 * PDF»). Se arma en un marco oculto, en orden cronológico, agrupado por meses; con una portada
 * si son varias.
 */
export async function exportDiaryPdf(
  list: Entry[],
  { people, photos = true }: { people: Person[]; photos?: boolean },
) {
  if (!list.length) return;
  const entries = [...list].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const firstDay = dayOf(entries[0]);
  const lastDay = dayOf(entries[entries.length - 1]);
  const many = entries.length > 1;

  let html = "";
  if (many)
    html += `<section class="cover"><small>Diario</small><h1>${
      firstDay === lastDay
        ? esc(longDay(firstDay))
        : year(firstDay) === year(lastDay)
          ? `Mi ${year(firstDay)}`
          : `${year(firstDay)} – ${year(lastDay)}`
    }</h1><p>${esc(longDay(firstDay))} de ${year(firstDay)}${
      firstDay !== lastDay
        ? ` — ${esc(longDay(lastDay))} de ${year(lastDay)}`
        : ""
    }<br>${entries.length} entradas</p></section>`;

  let month = "";
  for (const e of entries) {
    const date = dayOf(e);
    if (many && date.slice(0, 7) !== month) {
      month = date.slice(0, 7);
      html += `<h2 class="month">${esc(monthTitle(month))}</h2>`;
    }
    const linked = e.person_ids
      .map((id) => byId.get(id))
      .filter((p): p is Person => Boolean(p));
    const names = linked.map((p) => p.name.split(" ")[0]);
    const feelings = feelingsOf(e.details)
      .map((f) => {
        const m = moodOf(f.mood);
        return m
          ? `<span>${esc(m.label)}${f.why ? ` · ${esc(f.why)}` : ""}</span>`
          : "";
      })
      .join("");
    const meta = metaOf(e);
    const imgs = photos
      ? e.images
          .slice(0, 6)
          .map((i) => `<img src="${esc(i.medium ?? i.url)}" alt="">`)
          .join("")
      : "";
    const foot = [
      linked.length ? `Con ${esc(linked.map((p) => p.name).join(", "))}` : "",
      e.tags.length ? e.tags.map((t) => `<i>#${esc(t)}</i>`).join(" ") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    html += `<article>
      <div class="date"><b>${esc(longDay(date))}</b> de ${year(date)}</div>
      ${meta.length ? `<div class="meta">${esc(meta.join(" · "))}</div>` : ""}
      ${feelings ? `<div class="moods">${feelings}</div>` : ""}
      ${e.title ? `<h3>${esc(e.title)}</h3>` : ""}
      <div class="body">${richHtml(e.body, names)}</div>
      ${imgs ? `<div class="photos">${imgs}</div>` : ""}
      ${foot ? `<div class="foot">${foot}</div>` : ""}
    </article>`;
  }
  html += `<p class="end">Exportado desde Nexo · ${esc(longDay(todayInputValue()))}</p>`;

  const name = many
    ? `Diario ${firstDay}${firstDay !== lastDay ? ` a ${lastDay}` : ""}`
    : `Diario ${firstDay}${entries[0].title ? " - " + entries[0].title.slice(0, 40) : ""}`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(name)}</title>` +
      `<link rel="preconnect" href="https://fonts.googleapis.com">` +
      `<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">` +
      `<style>${STYLE}</style></head><body>${html}</body></html>`,
  );
  doc.close();

  // Espera a las fotos y a la letra (con un tope, para no quedarse colgado).
  const images = Array.from(doc.images).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((r) => {
          img.onload = img.onerror = () => r();
        }),
  );
  await Promise.race([
    Promise.all([...images, doc.fonts?.ready]),
    new Promise((r) => window.setTimeout(r, 6000)),
  ]);

  // Chrome toma el nombre del archivo del título de la página principal.
  const prevTitle = document.title;
  document.title = name;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = prevTitle;
    window.setTimeout(() => frame.remove(), 500);
  };
  frame.contentWindow!.addEventListener("afterprint", cleanup, { once: true });
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  // Algunos navegadores no avisan al terminar: se limpia igual pasado un rato.
  window.setTimeout(cleanup, 60_000);
}
