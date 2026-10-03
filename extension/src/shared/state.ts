import type { RunState, Session } from "./types";

const ACTIVE_STATES = new Set<RunState>(["waiting", "extracting", "asking", "selecting", "navigating", "reviewing"]);

/** True while a session is in progress (not idle, complete, stopped or errored). */
export const isActive = (s: Session | null | undefined): s is Session => !!s && ACTIVE_STATES.has(s.state);
