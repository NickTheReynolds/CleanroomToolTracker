// @ts-check
/**
 * Minimal GitHub REST client for sync: repository info, folder listing,
 * blob download and file upload, with the person's token. These are the
 * only requests the app makes to another site, and only when Sync runs.
 */
import { bytesToBase64, base64ToBytes } from '../data/export-import.js';

export const API = 'https://api.github.com';

export class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {number} status HTTP status, or 0 when GitHub could not be reached
   */
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/**
 * "owner/name" from what a person types: the short form, or a github.com
 * address with or without ".git".
 * @param {string} text
 * @returns {string | null} null when it is not a repository name
 */
export function parseRepo(text) {
  const t = String(text || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(t);
  return m && m[2] !== '.' && m[2] !== '..' ? `${m[1]}/${m[2]}` : null;
}

/** @param {string} path @returns {string} each segment URL-encoded */
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/**
 * @param {Response} res
 * @returns {Promise<GitHubError>}
 */
async function toError(res) {
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch { /* no JSON body */ }
  const s = res.status;
  if (s === 401) return new GitHubError('GitHub rejected the access token. It may have expired or been revoked; make a new one.', s);
  if (s === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return new GitHubError('GitHub’s request limit is reached. Try again in an hour.', s);
  }
  if (s === 403) return new GitHubError('The token is not allowed to do this. It needs “Contents: Read and write” on this repository.', s);
  if (s === 404) return new GitHubError('Repository not found, or the token cannot see it. Check the name and the token’s repository access.', s);
  return new GitHubError(`GitHub answered ${s}${detail ? `: ${detail}` : ''}.`, s);
}

/**
 * @typedef {Object} GitHubClient
 * @property {() => Promise<{private: boolean, full_name: string, permissions?: {push?: boolean}}>} repoInfo
 * @property {(dir: string) => Promise<{name: string, path: string, sha: string, type: string, size: number}[]>} list
 *   folder entries; [] when the folder does not exist yet
 * @property {(sha: string) => Promise<Uint8Array>} blob file bytes by blob sha
 * @property {(path: string, bytes: Uint8Array, message: string, sha?: string) => Promise<any>} put
 *   create or replace a file (sha = the version being replaced)
 */

/**
 * @param {{repo: string, token: string, fetch?: typeof fetch}} cfg
 * @returns {GitHubClient}
 */
export function githubClient(cfg) {
  const repo = parseRepo(cfg.repo);
  if (!repo) throw new GitHubError('The repository must look like owner/name.', 0);
  const doFetch = cfg.fetch || globalThis.fetch.bind(globalThis);
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   */
  const request = async (method, path, body) => {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await doFetch(`${API}${path}`, {
        method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GitHubError('Could not reach GitHub. Check the internet connection and try again.', 0);
    }
    if (!res.ok) throw await toError(res);
    return res.status === 204 ? null : res.json();
  };
  const base = `/repos/${repo}`;
  return {
    repoInfo: () => request('GET', base),
    async list(dir) {
      try {
        const r = await request('GET', `${base}/contents/${encodePath(dir)}`);
        return Array.isArray(r) ? r : [];
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return [];
        throw err;
      }
    },
    async blob(sha) {
      const b = await request('GET', `${base}/git/blobs/${encodeURIComponent(sha)}`);
      return base64ToBytes(String(b && b.content).replace(/\s/g, ''));
    },
    put: (path, bytes, message, sha) => request('PUT', `${base}/contents/${encodePath(path)}`, {
      message, content: bytesToBase64(bytes), ...(sha ? { sha } : {}),
    }),
  };
}
