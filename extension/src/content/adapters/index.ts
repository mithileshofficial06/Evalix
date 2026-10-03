import { SemanticAdapter } from "./semantic";
import type { DomAdapter } from "./types";

// Register adapters for other assessment systems you administer here. The first adapter whose
// detect() returns page info is used.
export const ADAPTERS: DomAdapter[] = [new SemanticAdapter()];

export function resolveAdapter(doc: Document): DomAdapter | null {
  return ADAPTERS.find((a) => a.detect(doc) !== null) ?? null;
}
