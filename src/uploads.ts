/**
 * Outbound attachments — uploading files to Zulip so a message can carry
 * them. zulip-js has no upload surface, so this goes straight at
 * `POST /api/v1/user_uploads` with the bot's credentials, the same realm +
 * Basic-auth pair the fetch side uses.
 *
 * Zulip attaches a file to a message by markdown link: the upload returns a
 * `/user_uploads/...` path and the message body links to it. Images so
 * linked get a preview in the web client automatically.
 */

import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ContentBlock } from '@animalabs/mcpl-core';

/** Zulip Cloud's default `MAX_FILE_UPLOAD_SIZE`. Self-hosted realms may differ; `ZULIP_UPLOAD_MAX_BYTES` overrides. */
export const DEFAULT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export function resolveUploadMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ZULIP_UPLOAD_MAX_BYTES ?? '');
  return Number.isFinite(n) && n > 0 && env.ZULIP_UPLOAD_MAX_BYTES !== undefined ? Math.floor(n) : DEFAULT_UPLOAD_MAX_BYTES;
}

export interface UploadInput {
  name: string;
  data: Buffer;
  mimeType?: string;
}

export interface UploadedFile {
  name: string;
  /** `/user_uploads/...` — what a message links to. */
  path: string;
  /** Absolute URL on the realm. */
  url: string;
}

export interface Uploader {
  upload(input: UploadInput): Promise<UploadedFile>;
}

export interface UploadTarget {
  realm: string;
  authHeader: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * A multipart/form-data body, built by hand. zulip-js drags in
 * isomorphic-form-data, which replaces the global `FormData` with a
 * stream-based one that cannot take a Blob — so neither the WHATWG form
 * nor that one is safe to rely on. A Buffer body works under every fetch.
 */
export function multipartBody(input: UploadInput, boundary: string): Buffer {
  const name = input.name.replace(/["\r\n]/g, '_');
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${input.mimeType || 'application/octet-stream'}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head, 'utf8'), input.data, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
}

/** An uploader bound to a realm and credentials. `fetchImpl` is for tests. */
export function createZulipUploader(target: UploadTarget, fetchImpl: FetchLike = fetch as unknown as FetchLike): Uploader {
  if (!target.realm) throw new Error('Cannot upload files: realm is unknown');
  const realm = target.realm.replace(/\/+$/, '');
  return {
    async upload(input: UploadInput): Promise<UploadedFile> {
      if (!target.authHeader) throw new Error('Cannot upload files: bot credentials are unknown (no email/api key)');
      const boundary = `----zulip-mcp-${randomBytes(12).toString('hex')}`;
      const res = await fetchImpl(`${realm}/api/v1/user_uploads`, {
        method: 'POST',
        headers: { Authorization: target.authHeader, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: multipartBody(input, boundary),
      });
      let body: { result?: string; msg?: string; uri?: string; url?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // Non-JSON body: fall through to the status check.
      }
      if (!res.ok || body.result !== 'success') {
        throw new Error(`upload of "${input.name}" failed: ${body.msg ?? `HTTP ${res.status}`}`);
      }
      // Older servers return `uri`; feature level 285+ adds `url`. Either is
      // the `/user_uploads/...` path.
      const path = body.uri ?? body.url;
      if (typeof path !== 'string' || !path.startsWith('/user_uploads/')) {
        throw new Error(`upload of "${input.name}" returned no usable path`);
      }
      return { name: input.name, path, url: `${realm}${path}` };
    },
  };
}

// ── Tool-argument form ──

/** One entry of a tool's `attachments` argument: a local file or inline bytes. */
export interface AttachmentArg {
  /** Path of a local file readable by this server. */
  file?: string;
  /** Base64-encoded bytes (with `name`). */
  data?: string;
  /** Filename shown in Zulip; defaults to the local file's basename. */
  name?: string;
  mime_type?: string;
}

/** Zulip only thumbnails (inline-previews) an upload whose declared type is
 *  `image/*`, and it does not sniff bytes or the filename: an image sent as
 *  octet-stream renders as a bare link forever. So a missing type is guessed
 *  from the extension for the common cases. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  json: 'application/json', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', html: 'text/html', htm: 'text/html', log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function guessMimeType(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext && ext !== name.toLowerCase() ? MIME_BY_EXT[ext] : undefined;
}

function fmt(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;
}

/** Resolve one attachment argument to bytes, enforcing the size ceiling before anything large is read. */
export async function loadAttachmentArg(arg: AttachmentArg, maxBytes: number): Promise<UploadInput> {
  if (typeof arg !== 'object' || arg === null) throw new Error('each attachment must be an object with `file` or `data`');
  const hasFile = typeof arg.file === 'string' && arg.file.trim() !== '';
  const hasData = typeof arg.data === 'string' && arg.data !== '';
  if (hasFile === hasData) throw new Error('each attachment needs exactly one of `file` (local path) or `data` (base64)');
  const mimeType = typeof arg.mime_type === 'string' && arg.mime_type ? arg.mime_type : undefined;

  if (hasFile) {
    const file = arg.file as string;
    const info = await stat(file).catch((err: Error) => { throw new Error(`attachment "${file}": ${err.message}`); });
    if (!info.isFile()) throw new Error(`attachment "${file}" is not a regular file`);
    if (info.size > maxBytes) throw new Error(`attachment "${file}" is ${fmt(info.size)}, over the ${fmt(maxBytes)} upload ceiling`);
    const name = (typeof arg.name === 'string' && arg.name.trim()) || basename(file);
    return { name, data: await readFile(file), mimeType: mimeType ?? guessMimeType(name) };
  }

  const name = typeof arg.name === 'string' ? arg.name.trim() : '';
  if (!name) throw new Error('inline attachments (`data`) need a `name`');
  const data = Buffer.from(arg.data as string, 'base64');
  if (data.length === 0) throw new Error(`attachment "${name}": data is not valid base64`);
  if (data.length > maxBytes) throw new Error(`attachment "${name}" is ${fmt(data.length)}, over the ${fmt(maxBytes)} upload ceiling`);
  return { name, data, mimeType: mimeType ?? guessMimeType(name) };
}

/** Validate and upload every attachment; all-or-nothing before any message is sent. */
export async function uploadAttachmentArgs(uploader: Uploader, args: unknown, maxBytes: number): Promise<UploadedFile[]> {
  if (args === undefined || args === null) return [];
  if (!Array.isArray(args)) throw new Error('attachments must be an array');
  const inputs: UploadInput[] = [];
  for (const arg of args) inputs.push(await loadAttachmentArg(arg as AttachmentArg, maxBytes));
  const out: UploadedFile[] = [];
  for (const input of inputs) out.push(await uploader.upload(input));
  return out;
}

/** The markdown Zulip uses to attach an upload to a message. */
export function attachmentMarkdown(file: UploadedFile): string {
  return `[${file.name}](${file.path})`;
}

/** Message body with attachment links appended (or just the links when there is no text). */
export function withAttachmentLinks(content: string, files: UploadedFile[]): string {
  if (files.length === 0) return content;
  const links = files.map(attachmentMarkdown).join('\n');
  const text = content.trim();
  return text ? `${text}\n\n${links}` : links;
}

// ── MCPL content blocks ──

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

function nameFor(kind: string, mimeType: string | undefined, index: number): string {
  const ext = (mimeType && EXT_FOR_MIME[mimeType.toLowerCase()]) || (mimeType?.split('/')[1] ?? 'bin');
  return `${kind}-${index + 1}.${ext}`;
}

/**
 * The non-text blocks of a publish, as upload inputs: inline `image`/`audio`
 * data, and `file://` URIs on any block (read from disk). Other URIs are
 * left to the caller — Zulip can only attach bytes this server holds.
 */
export async function uploadInputsFromBlocks(blocks: ContentBlock[], maxBytes: number): Promise<UploadInput[]> {
  const inputs: UploadInput[] = [];
  for (const [i, block] of blocks.entries()) {
    if (block.type === 'text') continue;
    const uri = 'uri' in block && typeof block.uri === 'string' ? block.uri : undefined;
    if (uri !== undefined) {
      if (!uri.startsWith('file://')) continue;
      const file = decodeURIComponent(new URL(uri).pathname);
      const mime = 'mimeType' in block && typeof block.mimeType === 'string' ? block.mimeType : undefined;
      inputs.push(await loadAttachmentArg({ file, mime_type: mime }, maxBytes));
      continue;
    }
    if ((block.type === 'image' || block.type === 'audio') && typeof block.data === 'string') {
      const mimeType = block.mimeType;
      inputs.push(await loadAttachmentArg({ data: block.data, name: nameFor(block.type, mimeType, i), mime_type: mimeType }, maxBytes));
    }
  }
  return inputs;
}
