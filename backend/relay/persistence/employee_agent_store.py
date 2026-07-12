"""Compatibility imports for the agent-store rename.

The persistence identity is now agent-first; keep the former module path only
for callers that have not yet moved to ``agent_store``.
"""

from .agent_store import DatabaseAgentStore, LocalAgentStore

LocalEmployeeAgentStore = LocalAgentStore
DatabaseEmployeeAgentStore = DatabaseAgentStore
