// Maps the AI's answer (an option letter for the question as it was *sent*) back to an element in
// the *current* DOM. The page may have re-rendered or reordered options while the request was in
// flight, so we match on option text first and only trust the letter if the text still agrees.
import type { ExtractedQuestion } from "../shared/types";
import type { Extraction, OptionHandle } from "./adapters/types";
import { normalize } from "./adapters/semantic";

export type MapResult = { ok: true; option: OptionHandle } | { ok: false; reason: string };

export function mapAnswer(sent: ExtractedQuestion, answerLetter: string, current: Extraction | null): MapResult {
  if (!current) return { ok: false, reason: "Question is no longer on the page" };
  if (current.question.questionId !== sent.questionId || normalize(current.question.text) !== normalize(sent.text)) {
    return { ok: false, reason: "Page moved to a different question before the answer arrived" };
  }

  const letter = answerLetter.trim().toUpperCase();
  const sentOption = sent.options.find((o) => o.id === letter);
  if (!sentOption) return { ok: false, reason: `Answer "${answerLetter}" is not one of ${sent.options.map((o) => o.id).join(", ")}` };

  const wanted = normalize(sentOption.text).toLowerCase();
  const byText = current.question.options.filter((o) => normalize(o.text).toLowerCase() === wanted);
  if (byText.length === 1) return { ok: true, option: current.options.find((h) => h.id === byText[0].id)! };
  if (byText.length > 1) {
    // Duplicate option texts: fall back to the letter if it is one of the duplicates.
    const same = byText.find((o) => o.id === letter);
    if (same) return { ok: true, option: current.options.find((h) => h.id === same.id)! };
    return { ok: false, reason: `Ambiguous answer: ${byText.length} options read "${sentOption.text}"` };
  }
  return { ok: false, reason: `Option "${sentOption.text}" is no longer on the page` };
}
