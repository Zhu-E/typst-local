// Version history: the sidebar "History" tab, the per-file diff view and the
// read-only preview of an old version.
import * as Y from 'yjs';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import { api, h, dialog, toast } from './common.js';
import { Preview } from './preview.js';

const STATUS_LABEL = { modified: 'Changed since', added: 'Added since', deleted: 'Deleted since' };

/**
 * @param {object} ctx
 * @param {string} ctx.projectId
 * @param {Y.Map<any>} ctx.files
 * @param {() => {name: string}} ctx.getUser
 * @param {(path: string) => import('@codemirror/state').Extension} ctx.editorExtensions
 * @param {() => void} ctx.onEnter  called before showing a version (the live editor should close)
 * @param {() => void} ctx.onExit  called after leaving version view so the live editor can reopen
 */
export function initHistory(ctx) {
  const $ = (id) => document.getElementById(id);
  const listEl = $('history-list');
  const versionPreview = new Preview($('version-pages'), { scroller: $('version-preview') });

  let versions = [];
  let selected = null; // {meta, data, changes}
  let selectedPath = null;
  let diffView = null;
  let stale = true;

  const base = `/api/projects/${ctx.projectId}/history`;
  const active = () => document.body.classList.contains('history-tab');

  // ---- list -------------------------------------------------------------

  async function refresh() {
    stale = false;
    try {
      versions = await api('GET', base);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    if (selected && !versions.some((v) => v.id === selected.meta.id)) exitVersion();
    if (selected) selected.meta = versions.find((v) => v.id === selected.meta.id);
    render();
  }

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function render() {
    const rows = [];
    let lastDay = null;
    for (const v of versions) {
      const day = dayLabel(v.ts);
      if (day !== lastDay) {
        rows.push(h('div.history-day', null, day));
        lastDay = day;
      }
      const isSel = selected?.meta.id === v.id;
      rows.push(
        h(
          'div.version' + (isSel ? '.selected' : '') + (v.name ? '.named' : ''),
          null,
          h(
            'button.version-head',
            { onclick: () => (isSel ? exitVersion() : selectVersion(v)) },
            h('span.version-time', null, timeFmt.format(v.ts)),
            h('span.version-title', null, v.name || v.note || 'Auto-saved'),
            v.authors?.length > 0 && h('span.version-authors', null, v.authors.join(', ')),
          ),
          isSel && renderDetails(),
        ),
      );
    }
    if (!versions.length) rows.push(h('p.history-empty', null, 'No versions yet.'));
    listEl.replaceChildren(...rows);
  }

  function renderDetails() {
    if (!selected.data) return h('div.version-body', null, h('span.muted', null, 'Loading…'));
    const v = selected.meta;
    const changes = selected.changes;
    return h(
      'div.version-body',
      null,
      h(
        'div.version-actions',
        null,
        h('button.btn.small.primary', { onclick: () => restore(v) }, 'Restore'),
        h('button.btn.small', { onclick: () => nameVersion(v) }, v.name ? 'Rename' : 'Name'),
        h('a.btn.small', { href: `${base}/${v.id}/pdf` }, 'PDF'),
      ),
      changes.length
        ? h(
            'div.version-files',
            null,
            h('div.version-files-label', null, `Changed since this version (${changes.length})`),
            changes.map((c) =>
              h(
                'button.version-file' + (c.path === selectedPath ? '.selected' : ''),
                { onclick: () => showFile(c.path), title: `${STATUS_LABEL[c.status]} this version` },
                h('span.change-mark.' + c.status, null, c.status[0].toUpperCase()),
                h('span.tree-name', null, c.path),
              ),
            ),
          )
        : h('p.version-same', null, 'Identical to the current project.'),
    );
  }

  // ---- selecting a version ----------------------------------------------

  function currentContent(path) {
    const v = ctx.files.get(path);
    if (v === undefined) return undefined;
    return v instanceof Y.Text ? v.toString() : { blob: v.blob, size: v.size };
  }

  const same = (a, b) => (typeof a === 'string' || typeof b === 'string' ? a === b : a?.blob === b?.blob);

  function computeChanges(data) {
    const paths = new Set([...Object.keys(data.files), ...ctx.files.keys()]);
    const out = [];
    for (const path of [...paths].sort()) {
      const then = data.files[path];
      const now = currentContent(path);
      if (then === undefined) out.push({ path, status: 'added' });
      else if (now === undefined) out.push({ path, status: 'deleted' });
      else if (!same(then, now)) out.push({ path, status: 'modified' });
    }
    return out;
  }

  async function selectVersion(v) {
    ctx.onEnter();
    selected = { meta: v, data: null, changes: [] };
    document.body.classList.add('viewing-version');
    $('version-banner-text').textContent = `${v.name ? v.name + ' · ' : ''}${fullFmt.format(v.ts)}`;
    render();
    renderVersionPreview(v);
    try {
      const data = await api('GET', `${base}/${v.id}`);
      if (selected?.meta.id !== v.id) return;
      selected.data = data;
      selected.changes = computeChanges(data);
      const first = selected.changes.find((c) => c.path === data.main) || selected.changes[0];
      showFile(first ? first.path : data.main);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function renderVersionPreview(v) {
    const status = $('version-preview-status');
    status.textContent = 'Rendering…';
    status.hidden = false;
    $('version-pages').classList.add('loading-pages');
    try {
      const res = await api('GET', `${base}/${v.id}/preview`);
      if (selected?.meta.id !== v.id) return;
      if (res.preview) {
        versionPreview.update(res.preview);
        status.hidden = true;
      } else {
        status.textContent = 'This version had errors and could not be rendered.';
      }
    } catch (e) {
      status.textContent = 'Could not render this version.';
    } finally {
      $('version-pages').classList.remove('loading-pages');
    }
  }

  function showFile(path) {
    selectedPath = path;
    render();
    const editorEl = $('editor');
    diffView?.destroy();
    diffView = null;
    editorEl.replaceChildren();

    const then = selected.data.files[path];
    const now = currentContent(path);
    const change = selected.changes.find((c) => c.path === path);
    $('file-title').textContent = path;
    $('diff-legend').hidden = !change;

    if ((then !== undefined && typeof then !== 'string') || (now !== undefined && typeof now !== 'string')) {
      const blobUrl = (hash, name) => `/api/projects/${ctx.projectId}/blob/${hash}?name=${encodeURIComponent(name)}`;
      const isImage = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path);
      const side = (label, content, src) =>
        h(
          'div.binary-side',
          null,
          h('div.muted', null, label),
          content === undefined
            ? h('p', null, '(does not exist)')
            : isImage && src
              ? h('img', { src })
              : h('p', null, typeof content === 'string' ? 'Text file' : `Binary file, ${content.size} bytes`),
        );
      editorEl.append(
        h(
          'div.binary-view.compare',
          null,
          side('In this version', then, then && typeof then !== 'string' ? blobUrl(then.blob, path) : null),
          side('Now', now, now && typeof now !== 'string' ? blobUrl(now.blob, path) : null),
        ),
      );
      return;
    }

    // A file that only exists on one side is shown whole, tinted, rather than diffed against nothing.
    const diff =
      then === undefined
        ? EditorView.editorAttributes.of({ class: 'whole-added' })
        : now === undefined
          ? EditorView.editorAttributes.of({ class: 'whole-deleted' })
          : unifiedMergeView({ original: then, mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 } });
    diffView = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: now ?? then,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          ctx.editorExtensions(path),
          diff,
        ],
      }),
    });
  }

  function exitVersion({ reopen = true } = {}) {
    if (!selected) return;
    selected = null;
    selectedPath = null;
    diffView?.destroy();
    diffView = null;
    document.body.classList.remove('viewing-version');
    $('diff-legend').hidden = true;
    render();
    if (reopen) ctx.onExit();
  }

  // ---- actions ----------------------------------------------------------

  async function restore(v) {
    const ok = await dialog({
      title: 'Restore this version?',
      message: `Every file will be changed back to how it was on ${fullFmt.format(v.ts)}, for everyone. The current state is saved in history first, so you can switch back to it later.`,
      confirm: 'Restore',
    });
    if (!ok) return;
    await api('POST', `${base}/${v.id}/restore`, { author: ctx.getUser().name });
    exitVersion();
    toast('Version restored');
  }

  async function nameVersion(v) {
    const res = await dialog({
      title: v.name ? 'Rename version' : 'Name this version',
      fields: [{ name: 'name', label: 'Name', value: v.name || '', placeholder: 'e.g. Submitted draft' }],
      confirm: 'Save',
    });
    if (!res) return;
    await api('PATCH', `${base}/${v.id}`, { name: res.name.trim() });
  }

  async function saveVersion() {
    const res = await dialog({
      title: 'Save a version',
      message: 'Captures the project as it is right now.',
      fields: [{ name: 'name', label: 'Name', placeholder: 'e.g. First full draft' }],
      confirm: 'Save version',
    });
    if (!res) return;
    await api('POST', base, { name: res.name.trim(), author: ctx.getUser().name });
    toast('Version saved');
  }

  // ---- wiring -----------------------------------------------------------

  function setTab(tab) {
    document.body.classList.toggle('history-tab', tab === 'history');
    document.body.classList.toggle('headings-tab', tab === 'headings');
    for (const name of ['files', 'history', 'headings']) $('tab-' + name).classList.toggle('active', tab === name);
    if (tab === 'history' && stale) refresh();
    if (tab !== 'history') exitVersion();
    ctx.onTab?.(tab);
  }

  $('tab-files').onclick = () => setTab('files');
  $('tab-history').onclick = () => setTab('history');
  $('tab-headings').onclick = () => setTab('headings');
  $('save-version-btn').onclick = () => saveVersion().catch((e) => toast(e.message, 'error'));
  $('version-exit').onclick = () => exitVersion();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected && !document.querySelector('.overlay')) exitVersion();
  });

  return {
    /** Server says the version list changed. */
    onHistoryChanged() {
      if (active()) refresh();
      else stale = true;
    },
    get viewing() {
      return !!selected;
    },
    exit: exitVersion,
  };
}
