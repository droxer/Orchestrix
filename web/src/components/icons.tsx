// Curated icon set for the Relay web UI. Wraps lucide-react so every glyph
// in the app shares one stroke width and we have one place to swap
// semantics later.

import {
  ArrowUp,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Copy,
  CalendarClock,
  CalendarDays,
  Columns3,
  FileText,
  FolderClosed,
  Rows3,
  Forward,
  Hash,
  Play,
  Info,
  KeyRound,
  Languages,
  LayoutGrid,
  ListTodo,
  Palette,
  LogOut,
  MessageCircleQuestion,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  RefreshCw,
  ScanEye,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Terminal,
  Zap,
  TriangleAlert,
  UserCog,
  UserPlus,
  Wrench,
  X,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  ChevronUp as LucideChevronUp,
  X as LucideX,
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
    <Icon ref={ref} strokeWidth={ICON_STROKE} aria-hidden="true" {...props} />
  ));
  Wrapped.displayName = displayName;
  return Wrapped;
}

// Semantic exports. Anywhere we want to swap the underlying glyph, do it
// here — no caller in the app has to know which lucide picture we chose.
export const NavConversations = withStandardStroke(MessagesSquare, "NavConversations");
export const NavWorkspace = withStandardStroke(Terminal, "NavWorkspace");
export const NavAdmin = withStandardStroke(UserCog, "NavAdmin");
export const NavBacklog = withStandardStroke(ListTodo, "NavBacklog");
export const NavChannels = withStandardStroke(Hash, "NavChannels");
export const NavRoutine = withStandardStroke(CalendarClock, "NavRoutine");
export const NavAgents = withStandardStroke(Bot, "NavAgents");
export const NavPreferences = withStandardStroke(Settings, "NavPreferences");
export const NavLogout = withStandardStroke(LogOut, "NavLogout");
export const NavRefresh = withStandardStroke(RefreshCw, "NavRefresh");
export const NavSidebarCollapse = withStandardStroke(PanelLeftClose, "NavSidebarCollapse");
export const NavSidebarExpand = withStandardStroke(PanelLeftOpen, "NavSidebarExpand");
export const NavNewThread = withStandardStroke(Plus, "NavNewThread");
// Compose a new conversation (pencil-in-square), the messaging-app convention.
export const ActionCompose = withStandardStroke(SquarePen, "ActionCompose");

export const ActionCopy = withStandardStroke(Copy, "ActionCopy");
export const ActionRetry = withStandardStroke(RefreshCw, "ActionRetry");
export const ActionSend = withStandardStroke(ArrowUp, "ActionSend");
export const ActionApprove = withStandardStroke(Check, "ActionApprove");
export const ActionHandoff = withStandardStroke(Forward, "ActionHandoff");
export const ActionStart = withStandardStroke(Play, "ActionStart");
export const ActionStop = withStandardStroke(CircleStop, "ActionStop");
export const ActionAddPerson = withStandardStroke(UserPlus, "ActionAddPerson");
export const ActionRemove = withStandardStroke(X, "ActionRemove");
export const ActionSearch = withStandardStroke(Search, "ActionSearch");
export const ActionCalendar = withStandardStroke(CalendarDays, "ActionCalendar");
export const WorkspaceFile = withStandardStroke(FileText, "WorkspaceFile");
export const WorkspaceFolder = withStandardStroke(FolderClosed, "WorkspaceFolder");
export const ViewBoard = withStandardStroke(Columns3, "ViewBoard");
export const ViewList = withStandardStroke(Rows3, "ViewList");
export const ViewGrid = withStandardStroke(LayoutGrid, "ViewGrid");
export const ActionKey = withStandardStroke(KeyRound, "ActionKey");

// Agent mode (智能体): a zap glyph reads as "execute work" without reusing
// the Bot mark reserved for preferences and artifact output types.
export const ModeAction = withStandardStroke(Zap, "ModeAction");
export const ModeReview = withStandardStroke(ScanEye, "ModeReview");
export const ModeAsk = withStandardStroke(MessageCircleQuestion, "ModeAsk");

// Preferences category glyphs.
export const PrefAppearance = withStandardStroke(Palette, "PrefAppearance");
export const PrefAgents = withStandardStroke(Bot, "PrefAgents");
export const PrefLanguage = withStandardStroke(Languages, "PrefLanguage");

// Stream markers form a deliberate geometric family: circle / triangle /
// circle for check / warn / error so they read as a system at a glance.
export const StreamThinking = withStandardStroke(Sparkles, "StreamThinking");
export const StreamTool = withStandardStroke(Wrench, "StreamTool");
export const StreamCommand = withStandardStroke(Terminal, "StreamCommand");
export const StreamCheck = withStandardStroke(CircleCheck, "StreamCheck");
export const StreamInfo = withStandardStroke(Info, "StreamInfo");
export const StreamWarn = withStandardStroke(TriangleAlert, "StreamWarn");
export const StreamError = withStandardStroke(CircleAlert, "StreamError");
export const StreamAttachment = withStandardStroke(Paperclip, "StreamAttachment");

// Artifact library glyphs. These deliberately reuse the existing semantic
// family so generated outputs scan by kind without adding a second icon style.
export const ArtifactPlan = withStandardStroke(ListTodo, "ArtifactPlan");
export const ArtifactDiff = withStandardStroke(FileText, "ArtifactDiff");
export const ArtifactReview = withStandardStroke(ScanEye, "ArtifactReview");
export const ArtifactTest = withStandardStroke(CircleCheck, "ArtifactTest");
export const ArtifactCommand = withStandardStroke(Terminal, "ArtifactCommand");
export const ArtifactSummary = withStandardStroke(FileText, "ArtifactSummary");
export const ArtifactOutput = withStandardStroke(Bot, "ArtifactOutput");
export const ArtifactFile = withStandardStroke(FileText, "ArtifactFile");

// shadcn primitives (sheet, select) reach for these by their original
// names; wrap them so they share ICON_STROKE with the rest of the app.
export const CheckIcon = withStandardStroke(LucideCheck, "CheckIcon");
export const ChevronDownIcon = withStandardStroke(LucideChevronDown, "ChevronDownIcon");
export const ChevronUpIcon = withStandardStroke(LucideChevronUp, "ChevronUpIcon");
export const XIcon = withStandardStroke(LucideX, "XIcon");
