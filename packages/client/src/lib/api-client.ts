/**
 * Typed API client for pi-kot's REST API.
 *
 * Inspired by pi-forge's packages/client/src/lib/api-client/index.ts.
 * All HTTP calls go through this module — components never call fetch() directly.
 */

const BASE = ""; // Same origin via Vite proxy

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

  // Attach auth token if available
  const token = getStoredToken();
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
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
