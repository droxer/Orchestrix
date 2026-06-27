// Curated icon set for the Relay web UI. Wraps lucide-react so every glyph
// in the app shares one stroke width and we have one place to swap
// semantics later.

import {
  ArrowUp,
  Check,
  CircleAlert,
  CircleCheck,
  CircleStop,
  CalendarClock,
  CalendarDays,
  Code2,
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
  Library,
  ListTodo,
  Palette,
  LogOut,
  MessageCircleQuestion,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plug,
  Plus,
  RefreshCw,
  ScanEye,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Terminal,
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
export const NavMcp = withStandardStroke(Plug, "NavMcp");
export const NavRoutine = withStandardStroke(CalendarClock, "NavRoutine");
export const NavSkills = withStandardStroke(Library, "NavSkills");
export const NavPreferences = withStandardStroke(Settings, "NavPreferences");
export const NavLogout = withStandardStroke(LogOut, "NavLogout");
export const NavRefresh = withStandardStroke(RefreshCw, "NavRefresh");
export const NavSidebarCollapse = withStandardStroke(PanelLeftClose, "NavSidebarCollapse");
export const NavSidebarExpand = withStandardStroke(PanelLeftOpen, "NavSidebarExpand");
export const NavNewThread = withStandardStroke(Plus, "NavNewThread");
// Compose a new conversation (pencil-in-square), the messaging-app convention.
export const ActionCompose = withStandardStroke(SquarePen, "ActionCompose");

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
export const ActionKey = withStandardStroke(KeyRound, "ActionKey");

export const ModeAction = withStandardStroke(Code2, "ModeAction");
export const ModeReview = withStandardStroke(ScanEye, "ModeReview");
export const ModeAsk = withStandardStroke(MessageCircleQuestion, "ModeAsk");

// Preferences category glyphs.
export const PrefAppearance = withStandardStroke(Palette, "PrefAppearance");
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

// shadcn primitives (sheet, select) reach for these by their original
// names; wrap them so they share ICON_STROKE with the rest of the app.
export const CheckIcon = withStandardStroke(LucideCheck, "CheckIcon");
export const ChevronDownIcon = withStandardStroke(LucideChevronDown, "ChevronDownIcon");
export const ChevronUpIcon = withStandardStroke(LucideChevronUp, "ChevronUpIcon");
export const XIcon = withStandardStroke(LucideX, "XIcon");
