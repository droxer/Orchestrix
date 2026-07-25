// Curated icon set for the Relay web UI. Wraps lucide-react so every glyph
// in the app shares one stroke width and we have one place to swap
// semantics later.

import {
  ArrowRightLeft,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleStop,
  Copy,
  CalendarClock,
  CalendarDays,
  Columns3,
  Container,
  CircleDashed,
  FileText,
  FolderClosed,
  Rows3,
  Forward,
  Hash,
  Inbox,
  ImagePlus,
  Play,
  Info,
  KeyRound,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ListTodo,
  LockKeyhole,
  Palette,
  LogOut,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ScanEye,
  Search,
  Server,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Terminal,
  Trash2,
  Users,
  Zap,
  TriangleAlert,
  UserCog,
  UserPlus,
  Wrench,
  X,
  XCircle,
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

// Large decorative strokes thin out as size grows so big glyphs (empty-state
// illustrations, ~40px+) read at the same optical weight as the 1.75 chrome
// icons instead of looking bloated. One shared value so future large icons
// don't each pick their own number.
export const ICON_STROKE_LARGE = 1.25;

function withStandardStroke(Icon: LucideIcon, displayName: string) {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Icon ref={ref} strokeWidth={ICON_STROKE} aria-hidden="true" {...props} />
  ));
  Wrapped.displayName = displayName;
  return Wrapped;
}

// Semantic exports. Anywhere we want to swap the underlying glyph, do it
// here — no caller in the app has to know which lucide picture we chose.
export const NavThreads = withStandardStroke(MessagesSquare, "NavThreads");
export const NavWorkspace = withStandardStroke(Terminal, "NavWorkspace");
export const NavAdmin = withStandardStroke(UserCog, "NavAdmin");
export const NavBacklog = withStandardStroke(ListTodo, "NavBacklog");
export const NavChannels = withStandardStroke(Hash, "NavChannels");
export const NavRoutine = withStandardStroke(CalendarClock, "NavRoutine");
export const NavAgents = withStandardStroke(Bot, "NavAgents");
export const NavTeams = withStandardStroke(Users, "NavTeams");
export const NavPreferences = withStandardStroke(Settings, "NavPreferences");
export const NavLogout = withStandardStroke(LogOut, "NavLogout");
export const NavRefresh = withStandardStroke(RefreshCw, "NavRefresh");
export const NavSidebarCollapse = withStandardStroke(PanelLeftClose, "NavSidebarCollapse");
export const NavSidebarExpand = withStandardStroke(PanelLeftOpen, "NavSidebarExpand");
export const NavMore = withStandardStroke(MoreHorizontal, "NavMore");
export const NavNewThread = withStandardStroke(Plus, "NavNewThread");
// Compose a new thread (pencil-in-square), the messaging-app convention.
export const ActionCompose = withStandardStroke(SquarePen, "ActionCompose");

export const ActionCopy = withStandardStroke(Copy, "ActionCopy");
export const ActionRetry = withStandardStroke(RefreshCw, "ActionRetry");
export const ActionSend = withStandardStroke(ArrowUp, "ActionSend");
export const ActionApprove = withStandardStroke(Check, "ActionApprove");
export const ActionHandoff = withStandardStroke(Forward, "ActionHandoff");
// Routing a turn to another agent — the two-way arrows read as "pass along",
// matching the transcript handoff phase divider.
export const ActionRoute = withStandardStroke(ArrowRightLeft, "ActionRoute");
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
export const ActionImage = withStandardStroke(ImagePlus, "ActionImage");

// Node run mode glyphs — managed (BoxLite VM = a container/box),
// local (direct execution = a shell), pending (awaiting daemon = a dashed ring).
export const NodeManaged = withStandardStroke(Container, "NodeManaged");
export const NodeLocal = withStandardStroke(Terminal, "NodeLocal");
export const NodePending = withStandardStroke(CircleDashed, "NodePending");

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

// Generic actions not covered above.
export const ActionAdd = withStandardStroke(Plus, "ActionAdd");
export const ActionEdit = withStandardStroke(Pencil, "ActionEdit");
export const ActionToggle = withStandardStroke(Power, "ActionToggle");

// Admin page glyphs — node/employee management and channel setup.
export const AdminNode = withStandardStroke(Server, "AdminNode");
export const AdminManageExecutors = withStandardStroke(Settings2, "AdminManageExecutors");
export const AdminDelete = withStandardStroke(Trash2, "AdminDelete");
export const AdminDashboard = withStandardStroke(LayoutDashboard, "AdminDashboard");
export const AdminEmployees = withStandardStroke(Users, "AdminEmployees");
export const AdminConnect = withStandardStroke(Link2, "AdminConnect");
export const AdminLocked = withStandardStroke(LockKeyhole, "AdminLocked");
export const AdminChannel = withStandardStroke(MessageSquare, "AdminChannel");
export const AdminVerified = withStandardStroke(ShieldCheck, "AdminVerified");
export const AdminInbox = withStandardStroke(Inbox, "AdminInbox");

// Dashboard activity feed markers.
export const ActivitySuccess = withStandardStroke(CheckCircle2, "ActivitySuccess");
export const ActivityPending = withStandardStroke(CircleDot, "ActivityPending");
export const ActivityNewMessage = withStandardStroke(MessageSquarePlus, "ActivityNewMessage");
export const ActivityFailed = withStandardStroke(XCircle, "ActivityFailed");
