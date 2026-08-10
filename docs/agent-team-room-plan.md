# Agent Team Room Plan

This implementation plan has been retired. It described the former
Ask/Action/Review execution-mode architecture and is intentionally not retained
as an active specification.

The current behavior is defined by:

- [ADR-014: Agent-Team Round Contracts](adr/014-agent-team-round-contracts.md)
- [ADR-015: Adaptive Agent Execution](adr/015-adaptive-agent-execution.md)

An Agent or Agent Team receives the user's goal through one execution path and
decides whether to answer, investigate, plan, modify, validate, review, or ask
for missing input. Team roles, assignment briefs, and phases coordinate the
round; they are not execution modes and are not user-selectable UI state.
