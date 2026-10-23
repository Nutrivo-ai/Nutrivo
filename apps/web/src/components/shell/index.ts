// The workspace shell (T-102, docs/10): rail, header with the workspace switcher, the phone chrome, and the states a
// workspace route can be in. Routes under src/app/w/[workspace] import from here.
export { ShellProvider, useOptionalShell, useShell, type ShellValue } from "./context";
export { NoAccess } from "./NoAccess";
export { Rail, RailNav, railGroups, regionsLine, type RailGroup, type RailItem } from "./Rail";
export { ScreenPlaceholder } from "./ScreenPlaceholder";
export { ScreenHeader, Shell, ShellFrame, activeNavRoute } from "./Shell";
export { ShellError, ShellLoading } from "./states";
export { Wordmark } from "./Wordmark";
export { WorkspaceList, WorkspaceSwitcher } from "./WorkspaceSwitcher";
