# relay-chat

`relay-chat` is the provider-neutral chat gateway for Relay. Discord, Telegram,
Lark, and future chat systems should enter through this package instead of
calling daemon nodes directly.

```text
chat provider -> relay-chat adapter -> Relay backend -> daemon -> sandbox agent
```

The package keeps platform details at the edge:

- Discord user/channel/thread IDs stay in the Discord adapter.
- Telegram user/chat/topic IDs stay in the Telegram adapter.
- Lark `open_id`, `union_id`, `chat_id`, and `thread_id` stay in the Lark adapter.

The shared core works with `employeeId`, `sessionId`, logical `agentId`,
mode, and task goal. Authorization remains a backend responsibility.

The provider modules also export verified webhook handlers for Discord
interactions, Telegram updates, and Lark events. They acknowledge provider
requests, normalize commands, call `RelayChatGateway`, and send throttled status
updates without exposing raw agent output.

`relay-chat-server` is the deployable HTTP entrypoint. It reads active provider
settings from the Relay backend with `RELAY_CHAT_TOKEN`, stores provider event
IDs durably under `.relay/chat/`, and exposes the verified webhook handlers.
Set `RELAY_CHAT_PUBLIC_URL` so startup can register Discord commands and the
Telegram webhook.

Use `RelayChatIdentityResolver` with the Admin Console's chat integration setup
when running provider adapters in production. It resolves provider users through
the backend's active identity links and allowed-conversation gates.

For setup, provider-specific adapter guidance, identity mapping, security, and
rollout steps, see [Chat Integrations](../../docs/chat-integrations.md).
