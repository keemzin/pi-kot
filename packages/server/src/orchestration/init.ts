/**
 * Boot-time wiring of the orchestration event bridge to the
 * forge-native singleton event channels (ask-user-question).
 *
 * Per-AgentSession events (agent_start, agent_end) are dispatched
 * from inside session-registry — those need the LiveSession context
 * at construction time. session-registry also calls
 * `notifySupervisorIdle` on supervisor agent_end.
 *
 * The DELETE-side `worker.deleted` event is fired from the sessions
 * DELETE route.
 */
import { subscribe as subscribeAskQuestions } from "../ask-user-question/registry.js";
import { bridgeWorkerAskUserQuestion } from "./event-bridge.js";

export function initOrchestrationAskUserQuestionBridge(): () => void {
  return subscribeAskQuestions((event) => {
    if (event.type !== "ask_user_question") return;
    void bridgeWorkerAskUserQuestion(event.sessionId, event.questions, event.requestId);
  });
}
