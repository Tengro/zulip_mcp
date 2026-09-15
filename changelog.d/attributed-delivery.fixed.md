- Delivered messages name their author, place and id in the body the model
  reads: `[<time> id=N] [#stream > topic] Author (mention): text` (`[DM]`
  for direct messages) on `channels/incoming`, `push/event` and messages
  recovered onto an open channel. agent-framework's context strategies
  render only the content blocks, so a mention used to arrive as bare text
  with no author, topic or id, and agents guessed the speaker from a
  separately injected backscroll. Prefixed messages are stamped
  `attributed: true` and `attributionHeader` in their metadata and in the
  push origin, for host strategies that render their own header.
  `ZULIP_ATTRIBUTE_DELIVERY=false` restores bare bodies.
