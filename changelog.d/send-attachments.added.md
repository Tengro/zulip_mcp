- Outbound files: `send_message` and `send_dm` take an `attachments` array
  (root-relative local paths or base64 bytes, optional `mime_type`, guessed
  from the extension otherwise), uploaded to the realm before the send and
  linked at the end of the message so images get a preview; `content` may
  be omitted when files are given. A new `upload_file` tool uploads alone
  and returns the path, URL and markdown link; it belongs to
  `zulip.messaging` like the send tools. MCPL publishes carry `image` and
  `audio` blocks with inline data the same way.
- Local-file attachments are confined to named roots: `ZULIP_UPLOAD_ROOTS`
  (`notes=./notes,out=/srv/out`) exports the directories a `file` of the
  form `<root>/<path>` may come from, resolved with symlinks and checked for
  containment; unset, local files are refused and only base64 works. Limits:
  per-file ceiling from the realm's advertised cap (`ZULIP_UPLOAD_MAX_BYTES`
  overrides; 25 MiB when unknown), enforced on the bytes read; at most 10
  files and 4× the per-file cap per message.
