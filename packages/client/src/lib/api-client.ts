/**
 * Typed API client for pi-kot's REST API.
 *
 * All HTTP calls go through this module — components never call fetch() directly.
 */

const BASE = ""; // Same origin via Vite proxy

import type { SessionContextResponse, McpServersResponse, McpSettingsResponse, McpServerConfig, ToolOverridesResponse } from "./api-client/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const token = getStoredToken();
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.message ?? data.error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// ---- Auth ----

export interface HealthResponse {
  status: string;
  activeSessions: number;
}

export interface AuthStatusResponse {
  authEnabled: boolean;
}

export interface LoginResponse {
  token: string;
}

export function getStoredToken(): string | undefined {
  try {
    const t = localStorage.getItem("pi-kot/auth-token");
    return t ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem("pi-kot/auth-token");
  } catch {
    // private mode
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("GET", "/api/v1/health");
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return request<AuthStatusResponse>("GET", "/api/v1/auth/status");
}

export async function login(password: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? "login_failed");
  }
  const data = (await res.json()) as LoginResponse;
  try {
    localStorage.setItem("pi-kot/auth-token", data.token);
  } catch {
    // private mode
  }
  return data;
}

// ---- Sessions ----

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  isLive: boolean;
  name?: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  supervisorId?: string;
}

export interface CreateSessionRequest {
  projectId?: string;
  workspacePath?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  projectId: string;
  createdAt: string;
}

export interface SessionMessagesResponse {
  messages: unknown[];
}

export interface PromptResponse {
  accepted: boolean;
}

export async function createSession(
  req: CreateSessionRequest = {},
): Promise<CreateSessionResponse> {
  return request<CreateSessionResponse>("POST", "/api/v1/sessions", req);
}

export async function listSessions(
  projectId?: string,
): Promise<{ sessions: SessionSummary[] }> {
  const qs = projectId !== undefined ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<{ sessions: SessionSummary[] }>("GET", `/api/v1/sessions${qs}`);
}

export async function getSessionMessages(
  sessionId: string,
): Promise<SessionMessagesResponse> {
  return request<SessionMessagesResponse>(
    "GET",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
}

export async function getSessionContext(
  sessionId: string,
): Promise<SessionContextResponse> {
  return request<SessionContextResponse>(
    "GET",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/context`,
  );
}

export async function sendPrompt(
  sessionId: string,
  text: string,
  streamingBehavior?: "steer" | "followUp",
): Promise<PromptResponse> {
  return request<PromptResponse>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompt`,
    { text, streamingBehavior },
  );
}

export async function abortSession(sessionId: string): Promise<{ aborted: boolean }> {
  return request<{ aborted: boolean }>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/abort`,
  );
}

export async function deleteSession(sessionId: string): Promise<{ disposed: boolean }> {
  return request<{ disposed: boolean }>(
    "DELETE",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function steerSession(
  sessionId: string,
  text: string,
  mode: "steer" | "followUp" = "steer",
): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/steer`,
    { text, mode },
  );
}

export async function renameSession(
  sessionId: string,
  name: string,
): Promise<{ renamed: boolean }> {
  return request<{ renamed: boolean }>(
    "PATCH",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/name`,
    { name },
  );
}

export async function archiveSession(
  sessionId: string,
  projectId?: string,
): Promise<{ archived: boolean }> {
  return request<{ archived: boolean }>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/archive`,
    projectId !== undefined ? { projectId } : undefined,
  );
}

export async function unarchiveSession(
  sessionId: string,
  projectId: string,
): Promise<{ unarchived: boolean }> {
  return request<{ unarchived: boolean }>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/unarchive`,
    { projectId },
  );
}

export async function listArchivedSessions(
  projectId: string,
): Promise<{ sessions: SessionSummary[] }> {
  return request<{ sessions: SessionSummary[] }>(
    "GET",
    `/api/v1/sessions?projectId=${encodeURIComponent(projectId)}&archived=true`,
  );
}

// ---- Projects ----

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface BrowseSuggestions {
  suggestions: string[];
}

export async function browseDirectories(
  query: string,
): Promise<BrowseSuggestions> {
  return request<BrowseSuggestions>(
    "GET",
    `/api/v1/projects/browse?q=${encodeURIComponent(query)}`,
  );
}

export async function fetchProjects(): Promise<{ projects: Project[] }> {
  return request<{ projects: Project[] }>("GET", "/api/v1/projects");
}

export async function createProjectAPI(
  name: string,
  path: string,
): Promise<Project> {
  return request<Project>("POST", "/api/v1/projects", { name, path });
}

export async function deleteProjectAPI(
  id: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    "DELETE",
    `/api/v1/projects/${encodeURIComponent(id)}`,
  );
}

// ---- Files ----

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  truncated?: boolean;
}

export interface FileReadResponse {
  path: string;
  content: string;
  size: number;
  language: string;
  binary: boolean;
}

export async function filesTree(
  projectId: string,
  maxDepth?: number,
): Promise<FileTreeNode> {
  const qs = new URLSearchParams({ projectId });
  if (maxDepth !== undefined) qs.set("maxDepth", String(maxDepth));
  return request<FileTreeNode>("GET", `/api/v1/files/tree?${qs.toString()}`);
}

export async function filesRead(
  projectId: string,
  path: string,
): Promise<FileReadResponse> {
  const qs = new URLSearchParams({ projectId, path });
  return request<FileReadResponse>("GET", `/api/v1/files/read?${qs.toString()}`);
}

export async function filesWrite(
  projectId: string,
  path: string,
  content: string,
): Promise<{ path: string }> {
  return request("PUT", `/api/v1/files/write`, { projectId, path, content });
}

export async function filesDelete(
  projectId: string,
  path: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  const qs = new URLSearchParams({ projectId, path });
  if (opts?.recursive === true) qs.set("recursive", "true");
  return request("DELETE", `/api/v1/files/delete?${qs.toString()}`);
}

export async function filesSearch(
  projectId: string,
  q: string,
  opts?: { limit?: number; regex?: boolean; caseSensitive?: boolean },
): Promise<{
  engine: "ripgrep" | "node";
  matches: Array<{ path: string; line: number; column: number; length: number; lineSnippet: string }>;
  truncated: boolean;
}> {
  const qs = new URLSearchParams({ projectId, q });
  if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts?.regex) qs.set("regex", "1");
  if (opts?.caseSensitive) qs.set("caseSensitive", "1");
  return request("GET", `/api/v1/files/search?${qs.toString()}`);
}

// ---- Git Clone ----

export interface CloneRepoRequest {
  url: string;
  folderName: string;
  projectName: string;
  branch?: string;
  token?: string;
  insecureTls?: boolean;
}

export type CloneEvent =
  | { type: "started"; cloneUrlForDisplay: string }
  | { type: "progress"; phase: string; percent: number | null; raw: string }
  | { type: "stderr"; line: string }
  | { type: "done"; target: string }
  | { type: "project_created"; id: string; name: string; path: string }
  | { type: "error"; message: string };

export function cloneRepo(
  req: CloneRepoRequest,
  onEvent: (event: CloneEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const controller = new AbortController();
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  (async () => {
    try {
      const res = await fetch(`${BASE}/api/v1/projects/clone`, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data.message ?? data.error ?? "Clone failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new ApiError(0, "No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as CloneEvent;
              onEvent(event);
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => controller.abort();
}

// ---- Providers / Models ----

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
  hasAuth: boolean;
  supportedThinkingLevels: string[];
}

export interface ProviderGroup {
  provider: string;
  models: ModelInfo[];
}

export interface ProvidersResponse {
  providers: ProviderGroup[];
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  return request<ProvidersResponse>("GET", "/api/v1/config/providers");
}

export interface AuthSummaryResponse {
  providers: Record<string, { configured: boolean; source?: string; label?: string }>;
}

export async function getAuthSummary(): Promise<AuthSummaryResponse> {
  return request<AuthSummaryResponse>("GET", "/api/v1/config/auth");
}

export async function setApiKey(provider: string, apiKey: string): Promise<{ provider: string; configured: boolean }> {
  return request("PUT", `/api/v1/config/auth/${encodeURIComponent(provider)}`, { apiKey });
}

export async function removeApiKey(provider: string): Promise<void> {
  await request("DELETE", `/api/v1/config/auth/${encodeURIComponent(provider)}`);
}

export async function getSettings(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>("GET", "/api/v1/config/settings");
}

export async function updateSettings(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>("PUT", "/api/v1/config/settings", patch);
}

export async function getModelsJson(): Promise<{ providers: Record<string, unknown> }> {
  return request("GET", "/api/v1/config/models");
}

export async function putModelsJson(
  data: { providers: Record<string, unknown> },
): Promise<{ providers: Record<string, unknown> }> {
  return request("PUT", `/api/v1/config/models`, data);
}

// ---- Model Management ----

export interface SetModelResponse {
  provider: string;
  modelId: string;
}

export interface GetModelResponse {
  provider: string;
  modelId: string;
}

export async function setSessionModel(
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<SetModelResponse> {
  return request<SetModelResponse>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/model`,
    { provider, modelId },
  );
}

export async function getSessionModel(
  sessionId: string,
): Promise<GetModelResponse> {
  return request<GetModelResponse>(
    "GET",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/model`,
  );
}

// ---- Session Tree / Navigate / Fork ----

export interface SessionTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  role?: string;
  preview?: string;
  label?: string;
}

export interface SessionTreeResponse {
  leafId: string | null;
  branchIds: string[];
  entries: SessionTreeEntry[];
}

export async function getSessionTree(
  sessionId: string,
): Promise<SessionTreeResponse> {
  return request<SessionTreeResponse>(
    "GET",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/tree`,
  );
}

export interface NavigateSessionResponse {
  cancelled: boolean;
  aborted?: boolean;
  editorText?: string;
}

export async function navigateSession(
  sessionId: string,
  entryId: string,
  opts?: { summarize?: boolean; customInstructions?: string; label?: string },
): Promise<NavigateSessionResponse> {
  return request<NavigateSessionResponse>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/navigate`,
    { entryId, ...opts },
  );
}

export interface ForkSessionResponse {
  sessionId: string;
  projectId: string;
}

export async function forkSession(
  sessionId: string,
  entryId: string,
): Promise<ForkSessionResponse> {
  return request<ForkSessionResponse>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/fork`,
    { entryId },
  );
}

// ---- Ask User Question ----

export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect?: boolean;
}

export interface AskUserQuestionAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "chat" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

export async function getPendingAskQuestions(
  sessionId: string,
): Promise<{ requestId: string; questions: AskQuestion[] }[]> {
  const res = await request<{ pending: { requestId: string; questions: AskQuestion[] }[] }>(
    "GET",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/ask-user-question/pending`,
  );
  return res.pending;
}

export async function answerAskQuestion(
  sessionId: string,
  requestId: string,
  answers: AskUserQuestionAnswer[],
  cancelled = false,
): Promise<void> {
  await request(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/ask-user-question/answer`,
    { requestId, answers, cancelled },
  );
}

// ── Orchestration ──

export interface OrchestrationConfig {
  available?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  maxWorkersPerSupervisor?: number;
  tools?: string[];
}

export interface SessionOrchestrationRole {
  sessionId: string;
  role: "supervisor" | "worker" | "standalone";
  supervisorId?: string;
}

export interface WorkerListItem {
  workerId: string;
  state: string;
  isLive: boolean;
  name: string | null;
  messageCount: number | null;
  lastStateAt: string | null;
}

export interface InboxItem {
  id: string;
  type: string;
  workerId: string;
  occurredAt: string;
  data: Record<string, unknown>;
  delivered: boolean;
}

export async function fetchOrchestrationConfig(): Promise<OrchestrationConfig> {
  return request("GET", "/api/v1/orchestration/config");
}

export async function getSessionOrchestrationRole(
  sessionId: string,
): Promise<SessionOrchestrationRole> {
  return request(
    "GET",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function enableSupervisorUI(
  sessionId: string,
): Promise<{ enabled: boolean; sessionId: string }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}/enable`,
  );
}

export async function disableSupervisorUI(
  sessionId: string,
): Promise<{ disabled: boolean; sessionId: string }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}/disable`,
  );
}

export async function listWorkers(
  sessionId: string,
): Promise<{ workers: WorkerListItem[] }> {
  return request(
    "GET",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}/workers`,
  );
}

export async function fetchInbox(
  sessionId: string,
): Promise<{ items: InboxItem[]; count: number }> {
  return request(
    "GET",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}/inbox`,
  );
}

export async function clearInboxUI(
  sessionId: string,
): Promise<{ cleared: boolean }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(sessionId)}/inbox/clear`,
  );
}

export async function detachWorkerUI(
  supervisorId: string,
  workerId: string,
): Promise<{ detached: boolean; workerId: string }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(supervisorId)}/workers/${encodeURIComponent(workerId)}/detach`,
  );
}

export async function killWorkerUI(
  supervisorId: string,
  workerId: string,
): Promise<{ killed: boolean; workerId: string }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(supervisorId)}/workers/${encodeURIComponent(workerId)}/kill`,
  );
}

export async function resumeWorkerUI(
  supervisorId: string,
  workerId: string,
): Promise<{ resumed: boolean; workerId: string; wasCold: boolean }> {
  return request(
    "POST",
    `/api/v1/orchestration/sessions/${encodeURIComponent(supervisorId)}/workers/${encodeURIComponent(workerId)}/resume`,
  );
}

// ---- Extension Discovery ----

export interface DiscoveredExtension {
  name: string;
  source: "extensions_dir" | "agents_dir" | "package" | "builtin";
  description: string;
  version?: string;
  /** Original package identifier (e.g. "npm:@ayulab/pi-rewind"). Only set for package source. */
  package?: string;
  agentTypes?: string[];
  enablesFeatures?: string[];
}

export interface RecommendedExtension {
  id: string;
  name: string;
  description: string;
  package: string;
  category: "orchestration" | "tools" | "ui" | "integration" | "productivity";
  installed: boolean;
  verified?: boolean;
  providesAgentTypes?: string[];
  enablesFeatures?: string[];
  icon: string;
}

export interface AgentDef {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  source: "file" | "builtin";
}

export interface ExtensionsResponse {
  detected: DiscoveredExtension[];
  recommended: RecommendedExtension[];
  agents: AgentDef[];
}

export async function fetchExtensions(): Promise<ExtensionsResponse> {
  return request<ExtensionsResponse>("GET", "/api/v1/extensions");
}

export async function installExtension(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  return request("POST", "/api/v1/extensions/install", { package: packageName });
}

export async function uninstallExtension(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  return request("POST", "/api/v1/extensions/uninstall", { package: packageName });
}

// ---- Extension Commands (generic bridge) ----

export interface InvokeCommandResponse {
  accepted: boolean;
}

/**
 * Invoke a registered extension command (e.g. "/rewind") via the
 * extension UI bridge. Returns 202 Accepted — the command runs
 * asynchronously and drives its UI interactions over SSE
 * (`extension_ui_select`, `extension_ui_confirm`, etc.).
 */
export async function invokeExtensionCommand(
  sessionId: string,
  command: string,
  args?: string,
): Promise<InvokeCommandResponse> {
  return request<InvokeCommandResponse>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/command`,
    { command, args },
  );
}

/**
 * Respond to a pending extension UI interaction (select, confirm, input).
 * The `requestId` comes from the `extension_ui_*` SSE event.
 */
export async function respondExtensionUI(
  sessionId: string,
  requestId: string,
  value: unknown,
): Promise<{ resolved: boolean }> {
  return request<{ resolved: boolean }>(
    "POST",
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/extension-ui/respond`,
    { requestId, value },
  );
}

// ---- MCP ----

export async function getMcpSettings(): Promise<McpSettingsResponse> {
  return request<McpSettingsResponse>("GET", "/api/v1/mcp/settings");
}

export async function setMcpEnabled(enabled: boolean): Promise<McpSettingsResponse> {
  return request<McpSettingsResponse>("PUT", "/api/v1/mcp/settings", { enabled });
}

export async function listMcpServers(projectId?: string): Promise<McpServersResponse> {
  const qs = projectId !== undefined ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<McpServersResponse>("GET", `/api/v1/mcp/servers${qs}`);
}

export async function upsertMcpServer(
  name: string,
  config: McpServerConfig,
): Promise<{ name: string }> {
  return request<{ name: string }>(
    "PUT",
    `/api/v1/mcp/servers/${encodeURIComponent(name)}`,
    config,
  );
}

export async function deleteMcpServer(name: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    "DELETE",
    `/api/v1/mcp/servers/${encodeURIComponent(name)}`,
  );
}

export async function probeMcpServer(name: string, projectId?: string): Promise<McpServersResponse> {
  const qs = projectId !== undefined ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<McpServersResponse>(
    "POST",
    `/api/v1/mcp/servers/${encodeURIComponent(name)}/probe${qs}`,
  );
}

export async function grantStdioMcpTrust(projectId: string): Promise<{ trusted: boolean }> {
  return request<{ trusted: boolean }>("POST", `/api/v1/mcp/trust/${encodeURIComponent(projectId)}`);
}

export async function revokeStdioMcpTrust(projectId: string): Promise<void> {
  return request<void>("DELETE", `/api/v1/mcp/trust/${encodeURIComponent(projectId)}`);
}

// ---- Tool listing / overrides ----

export interface ToolListingItem {
  name: string;
  description: string;
  enabled: boolean;
  globalEnabled: boolean;
  projectOverride?: "enabled" | "disabled";
}

export interface ToolListing {
  builtin: ToolListingItem[];
  mcp: {
    server: string;
    scope: "global" | "project";
    projectId?: string;
    enabled: boolean;
    state: string;
    lastError?: string;
    tools: (ToolListingItem & { shortName: string })[];
  }[];
  extension: { packageSource: string; tools: ToolListingItem[] }[];
}

export async function listTools(projectId?: string): Promise<ToolListing> {
  const qs = projectId !== undefined ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<ToolListing>("GET", `/api/v1/config/tools${qs}`);
}

export async function setToolEnabled(
  family: "builtin" | "mcp" | "extension",
  name: string,
  enabled: boolean,
  opts?: { scope?: "global" | "project"; projectId?: string },
): Promise<{ ok: boolean }> {
  const qs = opts?.projectId !== undefined ? `?projectId=${encodeURIComponent(opts.projectId)}` : "";
  return request<{ ok: boolean }>(
    "PUT",
    `/api/v1/config/tools/${encodeURIComponent(family)}/${encodeURIComponent(name)}/enabled${qs}`,
    { enabled, scope: opts?.scope },
  );
}

export async function listToolOverrides(): Promise<ToolOverridesResponse> {
  return request<ToolOverridesResponse>("GET", "/api/v1/config/tools/overrides");
}

export async function clearToolProjectOverride(
  family: "builtin" | "mcp" | "extension",
  name: string,
  projectId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    "DELETE",
    `/api/v1/config/tools/${encodeURIComponent(family)}/${encodeURIComponent(name)}/enabled?projectId=${encodeURIComponent(projectId)}`,
  );
}
