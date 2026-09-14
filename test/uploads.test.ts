/**
 * Outbound uploads — the multipart POST against a local HTTP server, the
 * attachment-argument loader (local file / base64, the size ceiling), the
 * message-body link form, and the content-block → upload mapping.
 *
 * Run: node --import tsx --test test/uploads.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_UPLOAD_MAX_BYTES,
  createZulipUploader,
  loadAttachmentArg,
  guessMimeType,
  resolveUploadMaxBytes,
  uploadAttachmentArgs,
  uploadInputsFromBlocks,
  withAttachmentLinks,
  type UploadInput,
  type Uploader,
} from '../src/uploads.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'zulip-uploads-'));
}

test('the uploader POSTs multipart to /api/v1/user_uploads with the bot auth and returns the upload path', async () => {
  let seen: { auth: string | undefined; contentType: string | undefined; body: string; url: string | undefined } | null = null;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen = { auth: req.headers.authorization, contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString('latin1'), url: req.url };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: 'success', msg: '', uri: '/user_uploads/2/Ab/cd/report.txt' }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  try {
    const up = createZulipUploader({ realm: `http://127.0.0.1:${port}/`, authHeader: 'Basic abc' });
    const out = await up.upload({ name: 'report.txt', data: Buffer.from('hello there'), mimeType: 'text/plain' });
    assert.deepEqual(out, { name: 'report.txt', path: '/user_uploads/2/Ab/cd/report.txt', url: `http://127.0.0.1:${port}/user_uploads/2/Ab/cd/report.txt` });
    assert.ok(seen);
    assert.equal(seen!.url, '/api/v1/user_uploads');
    assert.equal(seen!.auth, 'Basic abc');
    assert.match(seen!.contentType ?? '', /^multipart\/form-data; boundary=/);
    assert.match(seen!.body, /name="file"; filename="report.txt"/);
    assert.match(seen!.body, /Content-Type: text\/plain/);
    assert.match(seen!.body, /hello there/);
  } finally {
    server.close();
  }
});

test('the uploader surfaces Zulip errors, and accepts the newer `url` field', async () => {
  let mode: 'error' | 'url' = 'error';
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (mode === 'error') {
        res.statusCode = 413;
        res.end(JSON.stringify({ result: 'error', msg: 'Uploaded file is larger than the allowed limit of 25 MiB' }));
      } else {
        res.end(JSON.stringify({ result: 'success', msg: '', url: '/user_uploads/2/Ab/cd/x.png' }));
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  try {
    const up = createZulipUploader({ realm: `http://127.0.0.1:${port}`, authHeader: 'Basic abc' });
    await assert.rejects(up.upload({ name: 'big.bin', data: Buffer.alloc(3) }), /upload of "big.bin" failed: Uploaded file is larger/);
    mode = 'url';
    const out = await up.upload({ name: 'x.png', data: Buffer.alloc(3) });
    assert.equal(out.path, '/user_uploads/2/Ab/cd/x.png');
  } finally {
    server.close();
  }
});

test('an uploader without credentials refuses rather than sending an anonymous upload', async () => {
  const up = createZulipUploader({ realm: 'https://z.example.com', authHeader: '' }, async () => { throw new Error('must not be called'); });
  await assert.rejects(up.upload({ name: 'a', data: Buffer.alloc(1) }), /credentials are unknown/);
  assert.throws(() => createZulipUploader({ realm: '', authHeader: 'Basic x' }), /realm is unknown/);
});

test('loadAttachmentArg reads a local file (basename as the name) or decodes base64, and enforces the ceiling', async () => {
  const dir = tmp();
  try {
    const file = join(dir, 'notes.md');
    writeFileSync(file, '# hi');
    const fromFile = await loadAttachmentArg({ file }, 1024);
    assert.equal(fromFile.name, 'notes.md');
    assert.equal(fromFile.data.toString(), '# hi');
    assert.equal(fromFile.mimeType, 'text/markdown', 'guessed from the extension');

    const renamed = await loadAttachmentArg({ file, name: 'renamed.md', mime_type: 'text/markdown' }, 1024);
    assert.equal(renamed.name, 'renamed.md');
    assert.equal(renamed.mimeType, 'text/markdown');

    const inline = await loadAttachmentArg({ data: Buffer.from('abc').toString('base64'), name: 'a.txt' }, 1024);
    assert.equal(inline.data.toString(), 'abc');
    assert.equal(inline.mimeType, 'text/plain');
    assert.equal((await loadAttachmentArg({ data: 'aGk=', name: 'blob' }, 1024)).mimeType, undefined, 'no extension, no guess');
    assert.equal((await loadAttachmentArg({ data: 'aGk=', name: 'x.weird' }, 1024)).mimeType, undefined);
    assert.equal((await loadAttachmentArg({ data: 'aGk=', name: 'shot.PNG' }, 1024)).mimeType, 'image/png');

    await assert.rejects(loadAttachmentArg({ file }, 2), /over the 2B upload ceiling/);
    await assert.rejects(loadAttachmentArg({ data: Buffer.from('abc').toString('base64'), name: 'a' }, 2), /over the 2B upload ceiling/);
    await assert.rejects(loadAttachmentArg({ file: join(dir, 'missing') }, 1024), /attachment ".*missing": ENOENT/);
    await assert.rejects(loadAttachmentArg({ file: dir }, 1024), /not a regular file/);
    await assert.rejects(loadAttachmentArg({ data: 'aGk=' }, 1024), /need a `name`/);
    await assert.rejects(loadAttachmentArg({}, 1024), /exactly one of `file`/);
    await assert.rejects(loadAttachmentArg({ file, data: 'aGk=' }, 1024), /exactly one of `file`/);
    await assert.rejects(loadAttachmentArg('x' as never, 1024), /must be an object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uploadAttachmentArgs validates every entry before uploading any', async () => {
  const uploaded: string[] = [];
  const uploader: Uploader = { async upload(i) { uploaded.push(i.name); return { name: i.name, path: `/user_uploads/1/${i.name}`, url: `https://z/user_uploads/1/${i.name}` }; } };
  await assert.rejects(uploadAttachmentArgs(uploader, [{ data: 'aGk=', name: 'ok.txt' }, { data: 'aGk=' }], 1024), /need a `name`/);
  assert.deepEqual(uploaded, []);
  const out = await uploadAttachmentArgs(uploader, [{ data: 'aGk=', name: 'a.txt' }, { data: 'aGk=', name: 'b.txt' }], 1024);
  assert.deepEqual(uploaded, ['a.txt', 'b.txt']);
  assert.deepEqual(out.map((f) => f.path), ['/user_uploads/1/a.txt', '/user_uploads/1/b.txt']);
  assert.deepEqual(await uploadAttachmentArgs(uploader, undefined, 1024), []);
  await assert.rejects(uploadAttachmentArgs(uploader, 'nope', 1024), /must be an array/);
});

test('withAttachmentLinks appends Zulip-style links, or is just the links when there is no text', () => {
  const files = [
    { name: 'a.png', path: '/user_uploads/1/a.png', url: 'https://z/user_uploads/1/a.png' },
    { name: 'b.pdf', path: '/user_uploads/1/b.pdf', url: 'https://z/user_uploads/1/b.pdf' },
  ];
  assert.equal(withAttachmentLinks('see attached', files), 'see attached\n\n[a.png](/user_uploads/1/a.png)\n[b.pdf](/user_uploads/1/b.pdf)');
  assert.equal(withAttachmentLinks('  ', files), '[a.png](/user_uploads/1/a.png)\n[b.pdf](/user_uploads/1/b.pdf)');
  assert.equal(withAttachmentLinks('plain', []), 'plain');
});

test('uploadInputsFromBlocks turns inline image/audio data and file:// resources into uploads, skipping text and remote URIs', async () => {
  const dir = tmp();
  try {
    const file = join(dir, 'log file.txt');
    writeFileSync(file, 'boom');
    const inputs: UploadInput[] = await uploadInputsFromBlocks([
      { type: 'text', text: 'hello' },
      { type: 'image', data: Buffer.from('png!').toString('base64'), mimeType: 'image/png' },
      { type: 'resource', uri: `file://${encodeURI(file)}` },
      { type: 'resource', uri: 'https://example.com/x.pdf' },
      { type: 'audio', data: Buffer.from('ogg!').toString('base64'), mimeType: 'audio/ogg' },
      { type: 'image', uri: 'https://example.com/remote.png' },
    ], 1024);
    assert.deepEqual(inputs.map((i) => [i.name, i.data.toString(), i.mimeType]), [
      ['image-2.png', 'png!', 'image/png'],
      ['log file.txt', 'boom', 'text/plain'],
      ['audio-5.ogg', 'ogg!', 'audio/ogg'],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the upload ceiling comes from ZULIP_UPLOAD_MAX_BYTES, defaulting to Zulip Cloud\'s 25MiB', () => {
  assert.equal(resolveUploadMaxBytes({}), DEFAULT_UPLOAD_MAX_BYTES);
  assert.equal(resolveUploadMaxBytes({ ZULIP_UPLOAD_MAX_BYTES: '1000' }), 1000);
  assert.equal(resolveUploadMaxBytes({ ZULIP_UPLOAD_MAX_BYTES: 'junk' }), DEFAULT_UPLOAD_MAX_BYTES);
  assert.equal(resolveUploadMaxBytes({ ZULIP_UPLOAD_MAX_BYTES: '0' }), DEFAULT_UPLOAD_MAX_BYTES);
});

test('guessMimeType covers the image types Zulip thumbnails, and nothing it does not know', () => {
  assert.equal(guessMimeType('a.png'), 'image/png');
  assert.equal(guessMimeType('a.JPG'), 'image/jpeg');
  assert.equal(guessMimeType('report.pdf'), 'application/pdf');
  assert.equal(guessMimeType('Makefile'), undefined);
  assert.equal(guessMimeType('a.xyz'), undefined);
});
