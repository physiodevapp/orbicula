// Tarjeta «Sesiones guardadas en este dispositivo» y el guardado de las sesiones (ver src/persistence/).
// Las medidas (sin vídeo ni imágenes) se guardan solas al terminar un protocolo o un análisis, para que una
// recarga no las pierda. Caducan a los 30 días, hasta 5, y se borran cuando se quiera. Nada sale del móvil.
import { summarizeProtocol } from '../protocol/summary.js';
import { provenance } from '../export/provenance.js';
import { renderSummary } from './summary.js';
import { exportJson, exportCsv } from './export.js';
import { TTL_DAYS, MAX_ITEMS } from '../persistence/store.js';

const $ = (id) => document.getElementById(id);
const KIND = { protocol: 'Protocolo en directo', 'protocol-video': 'Protocolo grabado y analizado', video: 'Vídeo analizado' };
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
const when = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * @param {{store: ReturnType<import('../persistence/store.js').createStore>|null, build?: string|null}} o
 *   `store` null: sin guardado (modo alojado, o sin IndexedDB); la tarjeta no aparece.
 */
export function createSavedCard({ store, build = null }) {
  const el = {
    card: $('savedCard'), list: $('savedList'), msg: $('savedMsg'), clear: $('savedClear'),
    view: $('savedView'), viewTitle: $('savedViewTitle'), viewNote: $('savedViewNote'), summary: $('savedSummary'), code: $('savedCode'),
    exportJson: $('savedExportJson'), exportCsv: $('savedExportCsv'), close: $('savedClose'), viewMsg: $('savedViewMsg'),
  };
  let open = null; // { header, data }
  let persistAsked = false;

  const say = (m) => { if (el.msg) el.msg.textContent = m; };

  async function refresh() {
    if (!store || !el.card) return;
    let items = [];
    try { items = await store.list(); } catch { items = []; }
    el.card.hidden = items.length === 0;
    el.list.replaceChildren(...items.map(row));
    if (open && !items.some((h) => h.id === open.header.id)) closeView();
  }

  function row(h) {
    const box = document.createElement('div');
    box.className = 'sum-card';
    const title = document.createElement('div');
    title.className = 'step-title';
    title.textContent = `${KIND[h.kind] ?? h.kind} · ${when(h.savedAt)}${h.code ? ` · ${h.code}` : ''}`;
    const hint = document.createElement('p');
    hint.className = 'hint';
    const parts = [];
    if (h.meta?.phases) parts.push(`${h.meta.phases} fases`);
    if (h.meta?.durationMs) parts.push(mmss(h.meta.durationMs));
    parts.push(`${h.meta?.kb ?? '?'} KB`, `se borra el ${new Date(h.expiresAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`);
    hint.textContent = h.readable ? parts.join(' · ') : 'Guardada con una versión más nueva de orbicula: aquí solo se puede borrar.';
    const buttons = document.createElement('div');
    buttons.className = 'control-row wrap';
    if (h.readable) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = 'Abrir';
      b.addEventListener('click', () => openSession(h.id));
      buttons.append(b);
    }
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn btn-quiet'; del.textContent = 'Borrar';
    del.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta sesión guardada? No se puede deshacer.')) return;
      try { await store.remove(h.id); say('Sesión borrada.'); } catch (err) { say(`No se pudo borrar (${err?.message ?? err}).`); }
      refresh();
    });
    buttons.append(del);
    box.append(title, hint, buttons);
    return box;
  }

  function closeView() {
    open = null;
    if (el.view) el.view.hidden = true;
  }

  async function openSession(id) {
    let loaded = null;
    try { loaded = await store.load(id); } catch { loaded = null; }
    if (!loaded) { say('No se pudo leer esa sesión (puede estar dañada o ser de una versión más nueva). Bórrala si no la necesitas.'); return; }
    open = loaded;
    const { header, data } = loaded;
    el.viewTitle.textContent = `${KIND[header.kind] ?? header.kind} · ${when(header.savedAt)}`;
    el.viewNote.textContent = [
      'Guardada solo en este móvil.',
      header.build && build && header.build !== build ? `Se hizo con otra versión de orbicula (${header.build}); el resumen se recalcula con la actual.` : '',
      header.kind === 'video' ? 'Para el JSON de diagnóstico, elige el mismo vídeo en «Vídeo grabado».' : '',
    ].filter(Boolean).join(' ');
    renderSummary(el.summary, summarizeProtocol(data.results), data.results);
    el.summary.hidden = false;
    el.code.value = header.code ?? '';
    el.viewMsg.textContent = '';
    el.view.hidden = false;
    el.view.scrollIntoView?.({ block: 'nearest' });
  }

  const input = () => ({ results: open.data.results, code: el.code.value, capture: open.data.capture });
  el.exportJson?.addEventListener('click', () => {
    if (!open) return;
    el.viewMsg.textContent = exportJson({ ...input(), appVersion: open.header.appVersion, flowConfig: open.data.flowConfig ?? undefined, analysis: open.data.analysis });
    store.patchCode(open.header.id, el.code.value).then(refresh, () => {});
  });
  el.exportCsv?.addEventListener('click', () => {
    if (!open) return;
    el.viewMsg.textContent = exportCsv(input());
    store.patchCode(open.header.id, el.code.value).then(refresh, () => {});
  });
  el.close?.addEventListener('click', closeView);
  el.clear?.addEventListener('click', async () => {
    if (!confirm('¿Borrar TODAS las sesiones guardadas en este móvil? No se puede deshacer.')) return;
    try { await store.clear(); say('Todo borrado.'); } catch (err) { say(`No se pudo borrar (${err?.message ?? err}).`); }
    closeView();
    refresh();
  });
  const note = $('savedNote');
  if (note) note.textContent = `Al terminar un protocolo o un análisis, orbicula guarda sus medidas (sin vídeo ni imágenes) solo en este móvil, para que no se pierdan si recargas la página. Se conservan ${MAX_ITEMS} sesiones como máximo y se borran solas a los ${TTL_DAYS} días. Nada sale del dispositivo.`;

  return {
    enabled: !!store,
    refresh,
    /**
     * Guarda una sesión terminada. Nunca lanza: si no se puede (ventana privada, sin espacio), la app sigue
     * igual y se avisa en la tarjeta. Devuelve la cabecera o null.
     */
    async save(rec) {
      if (!store) return null;
      try {
        const header = await store.save({
          build, analysis: provenance({ flowConfig: rec.flowConfig ?? undefined }), ...rec,
        });
        if (!persistAsked) { // pide que el navegador no lo borre solo (puede ignorarlo)
          persistAsked = true;
          try { await navigator.storage?.persist?.(); } catch { /* sin almacenamiento persistente */ }
        }
        await refresh();
        return header;
      } catch (err) {
        if (el.card) { el.card.hidden = false; say(`No se pudo guardar la sesión en este móvil (${err?.message ?? err}). Los resultados siguen en pantalla: descárgalos.`); }
        return null;
      }
    },
    /** Cabecera de la sesión guardada de un vídeo con esa huella, o null. */
    async find(fingerprint) {
      if (!store) return null;
      try { return await store.find(fingerprint); } catch { return null; }
    },
    async load(id) {
      if (!store) return null;
      try { return await store.load(id); } catch { return null; }
    },
    async patchCode(id, code) {
      if (!store || !id) return;
      try { await store.patchCode(id, code); await refresh(); } catch { /* el código es lo de menos */ }
    },
  };
}
