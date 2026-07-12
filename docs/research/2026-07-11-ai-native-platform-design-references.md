# AI-native platform design references

Research date: 2026-07-11. Sources below are first-party product documentation, release notes, or company posts. This is a reference for Relay's next UI pass, not a prescription to copy another product.

## What leading products are converging on

### 1. The enduring unit is a context-bearing workspace, not an isolated chat

ChatGPT Projects groups chats, files, instructions, saved outputs, and connected sources; it also gives the workspace an identifiable name, icon, and color in the sidebar. Its project-only memory makes the context boundary explicit. [OpenAI: Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)

**Relay implication:** Every main page should be legible as the same agent workspace seen through a different lens: conversations, artifacts, tasks, activity, and sources all belong to one persistent context. Preserve the Atelier identity, agent identity, and workspace status in the shell rather than resetting visual language per route.

### 2. Chat is the control surface; the work should appear beside it

ChatGPT Canvas opens the editable artifact in a right-hand pane, supports selection-scoped instructions, inline suggestions, direct editing, version restoration, and previewing rendered code. [OpenAI: Canvas](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-i)

Google describes Gemini Canvas similarly as an interactive space where people co-create documents or code, refine a draft, and preview generated React/HTML. [Google: Gemini release updates](https://gemini.google.com/updates)

**Relay implication:** Keep the conversation as the durable command/history rail, but make artifacts, plans, diffs, files, and live previews first-class adjacent surfaces. A task detail or artifact page should retain a narrow conversational continuation affordance rather than becoming a disconnected dashboard.

### 3. Make parallel agency visible, navigable, and safely bounded

Cursor's Agents Window is deliberately agent-centered and runs multiple agents across local, worktree, cloud, and SSH environments; its agent tabs support side-by-side or grid views. It uses isolated worktrees for parallel work and offers a deliberate “best-of-n” comparison flow. [Cursor: New Cursor Interface](https://cursor.com/changelog/3-0)

**Relay implication:** Treat agent presence as a product primitive: a consistent agent strip/chip system should show who is working, where, on what, and whether input or review is needed. Keep task status, execution environment, and handoff lineage close to the agent—not hidden in separate administration screens.

### 4. Use direct manipulation when users can point more easily than describe

Cursor Design Mode lets a user select a browser region and send that targeted context to an agent. ChatGPT Canvas likewise uses text selection and block comments to scope an edit. [Cursor: New Cursor Interface](https://cursor.com/changelog/3-0) [OpenAI: Canvas](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-i)

**Relay implication:** Across all views, give users a stable way to turn an object into agent context: select an activity, file, diff, task, or artifact and add it to the composer. Make the resulting context visible as a removable, named chip so the agent's working set never feels mysterious.

### 5. Reduce prompting with opinionated, visible primitives

Vercel's v0 direction emphasizes built-in forms, data storage, SEO, and content editing with direct configuration in the UI. Its stated goal is to reduce the prompts and code checks required for baseline work. [Vercel: new.website joins forces with v0](https://vercel.com/blog/new-website-joins-forces-with-v0)

**Relay implication:** Common agent operations should not require prose prompts: approval, rerun, handoff, attach evidence, schedule, assign a node, and inspect output should use consistent explicit controls. These primitives should look and behave the same in the agent workspace, task board, and admin surfaces.

## System-wide consistency rules for Relay

1. **One shell, many lenses.** Keep the Atelier navigation, type scale, color tokens, agent badge language, status semantics, and composer behavior identical across workspace, task, artifact, agents, channels, and admin routes.
2. **One object grammar.** Use a shared visual contract for agent, task, artifact, source, run, approval, and environment: icon/avatar, title, current state, owner, recency, and next action.
3. **One status vocabulary.** Reserve semantic colors and labels for state (working, awaiting input, needs review, succeeded, failed) instead of inventing page-specific badges.
4. **Action reveals context.** An action always exposes what the agent will receive, what environment it will use, and the expected output/review point.
5. **Progress is a narrative, not telemetry.** Favor concise checkpoints, evidence, and handoffs over dense, raw execution logs; raw detail remains available on demand.
6. **Responsive continuity.** On smaller screens, collapse the secondary surface into a sheet or focused mode, while maintaining the same workspace identity and agent controls.

## Design direction

Use the existing **Atelier** direction as Relay's recognizable layer: warm editorial workspace for human intention and a precise, darker operational layer for agents and execution. The current reference products validate AI-native interaction patterns—persistent context, side-by-side making, scoped feedback, explicit parallel work, and built-in operational primitives—rather than a single visual style. Relay should express those patterns through one coherent token and component system across every page.
