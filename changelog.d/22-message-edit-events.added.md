- Edits, topic moves and deletions of messages the agent has seen now reach
  it. The event queue registers `update_message` and `delete_message` (it
  asked only for `message` and `reaction`, so Zulip never sent them); a
  change surfaces as one `[edited]` / `[moved]` / `[deleted]` line in the
  shared message shape, tagged `chat:edited` / `chat:deleted` plus
  `chat:mention` when the message addresses the bot as it now reads. It is
  as visible as its message was: open channels see changes to accepted
  messages and to the bot's own, closed channels are pushed only addressed
  ones, re-renders and the bot's own edits never surface. `PlatformAdapter`
  gains an optional `onMessageChange` callback on `startEvents`. History
  and backscroll render edited messages with an `(edited)` trailer and
  `metadata.editedAt` (#22).
