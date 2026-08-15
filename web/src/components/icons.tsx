// Curated icon set for the Relay web UI. Wraps lucide-react so every glyph
// in the app shares one stroke width and we have one place to swap
// semantics later.

import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Coins,
  Copy,
  CalendarClock,
  CalendarDays,
  Cloud,
  Columns3,
  CircleDashed,
  File,
  FileDiff,
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
  Laptop,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ListTodo,
  LockKeyhole,
  Palette,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  ScanEye,
  Search,
  Server,
  Settings,
  Square,
  Settings2,
  ShieldCheck,
  SquarePen,
  Terminal,
  Trash2,
  UserRound,
  Users,
  WifiOff,
  TriangleAlert,
  UserCog,
  UserPlus,
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
// This module is the only place allowed to import lucide-react: a glyph
// reached for directly ships lucide's default stroke (2) next to our 1.75
// chrome, and a second component can then pick a different picture for a
// meaning that already has one.
export const NavThreads = withStandardStroke(MessagesSquare, "NavThreads");
export const NavAdmin = withStandardStroke(UserCog, "NavAdmin");
export const NavBacklog = withStandardStroke(ListTodo, "NavBacklog");
export const NavChannels = withStandardStroke(Hash, "NavChannels");
export const NavRoutine = withStandardStroke(CalendarClock, "NavRoutine");
export const NavAgents = withStandardStroke(Bot, "NavAgents");
// A team is a dispatch lead fanning out to members — the same idea the
// bespoke TeamMark draws. `Users` stays with employees (actual people), so
// the roster chip and the teams nav are no longer the same silhouette.
export const NavTeams = withStandardStroke(Network, "NavTeams");
export const NavPreferences = withStandardStroke(Settings, "NavPreferences");
export const NavLogout = withStandardStroke(LogOut, "NavLogout");
export const NavRefresh = withStandardStroke(RefreshCw, "NavRefresh");
export const NavSidebarCollapse = withStandardStroke(PanelLeftClose, "NavSidebarCollapse");
export const NavSidebarExpand = withStandardStroke(PanelLeftOpen, "NavSidebarExpand");
export const NavMore = withStandardStroke(MoreHorizontal, "NavMore");
export const NavComputer = withStandardStroke(Server, "NavComputer");
// Compose a new thread (pencil-in-square), the messaging-app convention.
export const ActionCompose = withStandardStroke(SquarePen, "ActionCompose");

export const ActionCopy = withStandardStroke(Copy, "ActionCopy");
export const ActionRetry = withStandardStroke(RefreshCw, "ActionRetry");
export const ActionSend = withStandardStroke(ArrowUp, "ActionSend");
// Starter-prompt chip affordance — the arrow reads as "drop this into the
// composer" without reusing the send glyph's meaning.
export const ActionPrompt = withStandardStroke(ArrowUpRight, "ActionPrompt");
export const ActionApprove = withStandardStroke(Check, "ActionApprove");
export const ActionHandoff = withStandardStroke(Forward, "ActionHandoff");
// Routing a turn to another agent — the two-way arrows read as "pass along",
// matching the transcript handoff phase divider.
export const ActionRoute = withStandardStroke(ArrowRightLeft, "ActionRoute");
export const ActionStart = withStandardStroke(Play, "ActionStart");
export const ActionStop = withStandardStroke(CircleStop, "ActionStop");
// Composer stop glyph — a solid square reads as "stop" instantly at small
// sizes, where the outline circle-stop collapses into a fuzzy ring. Solid
// fill, no stroke, so it sits cleanly on the filled plate.
export const ComposerStop = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
  <Square ref={ref} fill="currentColor" stroke="none" strokeWidth={0} aria-hidden="true" {...props} />
));
ComposerStop.displayName = "ComposerStop";
export const ActionAddPerson = withStandardStroke(UserPlus, "ActionAddPerson");
export const ActionRemove = withStandardStroke(X, "ActionRemove");
export const NavBack = withStandardStroke(ArrowLeft, "NavBack");
export const ActionSearch = withStandardStroke(Search, "ActionSearch");
export const ActionCalendar = withStandardStroke(CalendarDays, "ActionCalendar");
// A file is a blank sheet wherever it appears — the workspace tree and the
// artifact strip must not picture the same object two ways. `FileText`
// (ruled lines) is reserved for written prose, i.e. the summary artifact.
export const WorkspaceFile = withStandardStroke(File, "WorkspaceFile");
export const WorkspaceFolder = withStandardStroke(FolderClosed, "WorkspaceFolder");
export const ViewBoard = withStandardStroke(Columns3, "ViewBoard");
export const ViewList = withStandardStroke(Rows3, "ViewList");
export const ViewGrid = withStandardStroke(LayoutGrid, "ViewGrid");
export const ActionKey = withStandardStroke(KeyRound, "ActionKey");
export const ActionImage = withStandardStroke(ImagePlus, "ActionImage");

// Computer ownership glyphs. These answer "whose machine is this?", not "how
// does the daemon sandbox a run?" — sandbox mode stays a text-only badge. A
// cloud computer Relay provisions is a cloud; a local computer is a person's
// own machine (a laptop, the shape everyone reads as "my computer"); pending
// ownership is an unresolved ring. The earlier container/terminal pair
// pictured the runtime instead and read as "box" and "shell".
export const NodeManaged = withStandardStroke(Cloud, "NodeManaged");
export const NodeLocal = withStandardStroke(Laptop, "NodeLocal");
export const NodePending = withStandardStroke(CircleDashed, "NodePending");
export const NodeOffline = withStandardStroke(WifiOff, "NodeOffline");

// Preferences category glyphs.
export const PrefAppearance = withStandardStroke(Palette, "PrefAppearance");
export const PrefLanguage = withStandardStroke(Languages, "PrefLanguage");

// Outcome markers, shared by every surface that reports one (stream status
// lines, destructive dialogs). A deliberate geometric family: circle /
// circle / triangle / circle for info / ok / warn / error, so severity is
// carried by the enclosing shape and not by colour alone.
export const StatusOk = withStandardStroke(CircleCheck, "StatusOk");
export const StatusInfo = withStandardStroke(Info, "StatusInfo");
export const StatusWarn = withStandardStroke(TriangleAlert, "StatusWarn");
export const StatusError = withStandardStroke(CircleAlert, "StatusError");
export const StreamAttachment = withStandardStroke(Paperclip, "StreamAttachment");

// The thread space toggle shows and hides the right-hand panel; it is a
// panel control, not an attachment. A paperclip pictured "something clipped
// to this message" — the wrong object, since the panel holds what the thread
// *produced*. `PanelRight` joins the existing PanelLeft* sidebar pair so
// every chrome control that reveals a panel is drawn the same way, and the
// filled edge points at the side the panel appears on.
export const ThreadSpaceToggle = withStandardStroke(PanelRight, "ThreadSpaceToggle");

// Identity and metrics inside a transcript.
export const IdentityUser = withStandardStroke(UserRound, "IdentityUser");
export const MetricTokens = withStandardStroke(Coins, "MetricTokens");

// Artifact library glyphs. The artifact strip is a kind *filter*, so every
// kind needs its own picture: diff, summary and workspace file used to share
// one FileText, collapsing three of the eight kinds into one silhouette. The
// three paper-shaped kinds now separate by their mark — plus/minus for a
// diff, ruled lines for written prose, blank sheet for a produced file.
export const ArtifactPlan = withStandardStroke(ListTodo, "ArtifactPlan");
export const ArtifactDiff = withStandardStroke(FileDiff, "ArtifactDiff");
export const ArtifactReview = withStandardStroke(ScanEye, "ArtifactReview");
export const ArtifactTest = withStandardStroke(CircleCheck, "ArtifactTest");
export const ArtifactCommand = withStandardStroke(Terminal, "ArtifactCommand");
export const ArtifactSummary = withStandardStroke(FileText, "ArtifactSummary");
export const ArtifactOutput = withStandardStroke(Bot, "ArtifactOutput");
export const ArtifactFile = withStandardStroke(File, "ArtifactFile");

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
export const AdminRestore = withStandardStroke(RotateCcw, "AdminRestore");
export const AdminDashboard = withStandardStroke(LayoutDashboard, "AdminDashboard");
export const AdminEmployees = withStandardStroke(Users, "AdminEmployees");
export const AdminConnect = withStandardStroke(Link2, "AdminConnect");
export const AdminLocked = withStandardStroke(LockKeyhole, "AdminLocked");
// Same glyph as NavChannels — admin channel setup and the channels nav are
// the same object seen from two surfaces.
export const AdminChannel = withStandardStroke(Hash, "AdminChannel");
export const AdminVerified = withStandardStroke(ShieldCheck, "AdminVerified");
export const AdminInbox = withStandardStroke(Inbox, "AdminInbox");
export const AdminSettings = withStandardStroke(Settings, "AdminSettings");
