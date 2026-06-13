// Curated icon set for the Relay web UI. Wraps lucide-react (shadcn/ui's
// canonical icon library) so every glyph in the app shares one stroke
// width and we have one place to swap semantics later.

import {
  AtSign,
  Boxes,
  Cable,
  Check,
  CheckIcon,
  ChevronDownIcon,
  ChevronRight,
  ChevronUpIcon,
  CircleAlert,
  CircleStop,
  CornerDownLeft,
  GitBranch,
  Info,
  KeyRound,
  LogOut,
  MessagesSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
  XIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";

// Standard refined stroke for every icon in the product. Lucide defaults to
// 2 which feels chunky next to the rest of the type; 1.75 reads as
// engineering-precise without losing legibility at 13–18 px.
export const ICON_STROKE = 1.75;

function withStandardStroke(Icon: LucideIcon, displayName: string) {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Icon ref={ref} strokeWidth={ICON_STROKE} {...props} />
  ));
  Wrapped.displayName = displayName;
  return Wrapped;
}

// Semantic exports. Anywhere we want to swap the underlying glyph, do it
// here — no caller in the app has to know which lucide picture we chose.
export const NavConversations = withStandardStroke(MessagesSquare, "NavConversations");
export const NavSandboxes = withStandardStroke(Boxes, "NavSandboxes");
export const NavAdmin = withStandardStroke(SquareTerminal, "NavAdmin");
export const NavMcp = withStandardStroke(Cable, "NavMcp");
export const NavSkills = withStandardStroke(Sparkles, "NavSkills");
export const NavPreferences = withStandardStroke(Settings, "NavPreferences");
export const NavLogout = withStandardStroke(LogOut, "NavLogout");
export const NavRefresh = withStandardStroke(RefreshCw, "NavRefresh");
export const NavCollapse = withStandardStroke(ChevronRight, "NavCollapse");

export const ActionSend = withStandardStroke(CornerDownLeft, "ActionSend");
export const ActionApprove = withStandardStroke(Check, "ActionApprove");
export const ActionHandoff = withStandardStroke(GitBranch, "ActionHandoff");
export const ActionStop = withStandardStroke(CircleStop, "ActionStop");
export const ActionAddPerson = withStandardStroke(Plus, "ActionAddPerson");
export const ActionRemove = withStandardStroke(X, "ActionRemove");
export const ActionSearch = withStandardStroke(Search, "ActionSearch");
export const ActionMention = withStandardStroke(AtSign, "ActionMention");
export const ActionKey = withStandardStroke(KeyRound, "ActionKey");

export const StreamThinking = withStandardStroke(Sparkles, "StreamThinking");
export const StreamTool = withStandardStroke(Wrench, "StreamTool");
export const StreamCommand = withStandardStroke(Terminal, "StreamCommand");
export const StreamCheck = withStandardStroke(Check, "StreamCheck");
export const StreamInfo = withStandardStroke(Info, "StreamInfo");
export const StreamWarn = withStandardStroke(TriangleAlert, "StreamWarn");
export const StreamError = withStandardStroke(CircleAlert, "StreamError");
export const StreamAttachment = withStandardStroke(Paperclip, "StreamAttachment");

// Re-exports for shadcn-style primitive consumers (sheet, select) — they
// reach for these icons by their original names.
export { CheckIcon, ChevronDownIcon, ChevronUpIcon, XIcon };
