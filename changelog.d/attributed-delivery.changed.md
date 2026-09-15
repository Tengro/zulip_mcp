- One line shape everywhere the model reads a message: the `<missed>` block
  lines gain `#stream >` (`[#general > topic]`, `[DM]` in DM conversations),
  the history injected before inference gains ids and the full date-time,
  and `fetch_history` / `fetch_around` print the agent-visible time
  (`AGENT_TIMEZONE` / `AGENT_TIMESTAMP_STYLE`) instead of UTC. `(mention)`
  is no longer shown on direct messages. On message lines, `full` style
  drops its ` [Zone]` suffix; the offset stays. Header fields are folded
  onto one line.
