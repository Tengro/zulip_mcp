- Outbound files: `send_message` and `send_dm` take an `attachments` array
  (local file paths or base64 bytes, optional `mime_type`), uploaded to the
  realm before the send and linked at the end of the message so images get
  a preview; `content` may be omitted when files are given. A new
  `upload_file` tool uploads alone and returns the path, URL and markdown
  link. MCPL publishes carry `image`/`audio` blocks with inline data and
  `file://` resources the same way. `ZULIP_UPLOAD_MAX_BYTES` caps a single
  upload (default 25 MiB).
