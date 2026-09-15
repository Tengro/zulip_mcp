- **Gate filters:** agent-framework's wake gate matches `match.filter`
  against the message text, which now starts with the
  `[<time> id=N] [#stream > topic] Author: ` head. A `^`-anchored pattern no
  longer matches the body, and a keyword that also appears in a stream,
  topic or author name matches every message there; anchor on the body
  after the head, or match on channel, scope or tags.
- **connectome-host `frontdesk` deployments:** a frontdesk strategy that
  does not honour the `attributed` stamp renders its own provenance header
  as well, so the model reads two. Upgrade connectome-host to a release
  that skips its header for stamped messages, or set
  `ZULIP_ATTRIBUTE_DELIVERY=false` in the host environment or the server's
  `mcpl-servers.json` entry (a recipe `env` does not reach a server defined
  there).
