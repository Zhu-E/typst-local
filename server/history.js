// Version history for a project.
//
//   data/projects/<id>/history/index.json    version list, oldest first
//   data/projects/<id>/history/<vid>.json.gz  {main, files: {path: text | {blob, size}}}
//
// Snapshots store plain file contents (binary files by blob hash; blobs are
// never deleted, so old versions keep working). Versions are kept forever.
// `name` is a user-given label; `note` is a system description.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { projectDir } from './storage.js';

const historyDir = (id) => path.join(projectDir(id), 'history');
const indexPath = (id) => path.join(historyDir(id), 'index.json');
const versionPath = (id, vid) => {
  if (!/^[a-z0-9-]{1,40}$/.test(vid)) throw new Error('invalid version id');
  return path.join(historyDir(id), vid + '.json.gz');
};

export function listVersions(id) {
  try {
    return JSON.parse(fs.readFileSync(indexPath(id), 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(id, versions) {
  fs.mkdirSync(historyDir(id), { recursive: true });
  const tmp = indexPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(versions, null, 1));
  fs.renameSync(tmp, indexPath(id));
}

export function readVersion(id, vid) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(versionPath(id, vid))).toString('utf8'));
}

export const contentHash = (snapshot) => crypto.createHash('sha1').update(JSON.stringify(snapshot)).digest('hex');

/**
 * Stores a snapshot. Unnamed snapshots identical to the latest version are
 * skipped (returns null).
 */
export function addVersion(id, snapshot, { name = null, note = null, authors = [] } = {}) {
  const versions = listVersions(id);
  const hash = contentHash(snapshot);
  const latest = versions.at(-1);
  if (!name && latest?.hash === hash) return null;

  const ts = Date.now();
  const vid = ts.toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(historyDir(id), { recursive: true });
  fs.writeFileSync(versionPath(id, vid), zlib.gzipSync(JSON.stringify(snapshot)));

  const files = Object.keys(snapshot.files).length;
  const version = { id: vid, ts, name, note, authors: [...new Set(authors)].slice(0, 20), hash, files };
  versions.push(version);
  writeIndex(id, versions);
  return version;
}

export function renameVersion(id, vid, name) {
  const versions = listVersions(id);
  const v = versions.find((x) => x.id === vid);
  if (!v) return null;
  v.name = name || null;
  writeIndex(id, versions);
  return v;
}
