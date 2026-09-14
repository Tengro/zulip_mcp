- Delivered messages name their author, place and id in the body the model
  reads: `[<time> id=N] [#stream > topic] Author (mention): text` (`[DM]`
  for direct messages), the same line shape as `fetch_history`, on
  `channels/incoming`, `push/event`, recovered replays onto an open channel,
  and the backscroll of `channels/open`.
  Hosts render only the content blocks, so a mention used to arrive as bare
  text with no author, topic or id; agents had to guess the speaker from a
  separate backscroll. `ZULIP_ATTRIBUTE_DELIVERY=false` restores bare
  bodies for a host that renders the structured fields itself, which
  connectome-host's `frontdesk` strategy (the `clerk` recipe) does; set it
  there.
