import { beforeEach, describe, expect, it } from "vitest";
import { SemanticAdapter } from "../src/content/adapters/semantic";
import { mapAnswer } from "../src/content/mapper";
import { renderQuestion, SAMPLE, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();

beforeEach(() => setupPage());

describe("mapAnswer", () => {
  it("maps a letter to the matching option element", () => {
    renderQuestion("cards");
    const e = adapter.extract(document)!;
    const r = mapAnswer(e.question, "b", e);
    expect(r.ok && r.option.element.textContent).toBe("B. Heart");
  });

  it("follows the option text when the page reorders options", () => {
    renderQuestion("radio");
    const sent = adapter.extract(document)!.question; // B = Heart
    renderQuestion("radio", { q: { ...SAMPLE, options: [SAMPLE.options[1], SAMPLE.options[0], SAMPLE.options[2], SAMPLE.options[3]] } });
    const r = mapAnswer(sent, "B", adapter.extract(document));
    expect(r.ok && r.option.id).toBe("A"); // Heart is now first
  });

  it("rejects letters that are not options", () => {
    renderQuestion("radio");
    const e = adapter.extract(document)!;
    expect(mapAnswer(e.question, "E", e)).toMatchObject({ ok: false });
  });

  it("rejects when the page has moved to another question", () => {
    renderQuestion("radio");
    const sent = adapter.extract(document)!.question;
    renderQuestion("radio", { q: { ...SAMPLE, id: "q08", text: "Different?" } });
    expect(mapAnswer(sent, "B", adapter.extract(document))).toMatchObject({ ok: false, reason: expect.stringMatching(/different question/) });
  });

  it("rejects when the question vanished", () => {
    renderQuestion("radio");
    const sent = adapter.extract(document)!.question;
    expect(mapAnswer(sent, "B", null)).toMatchObject({ ok: false });
  });

  it("uses the letter to disambiguate duplicate option texts", () => {
    const dup = { ...SAMPLE, options: [{ id: "A", text: "Same" }, { id: "B", text: "Same" }, { id: "C", text: "Other" }] };
    renderQuestion("listbox", { q: dup });
    const e = adapter.extract(document)!;
    const r = mapAnswer(e.question, "B", e);
    expect(r.ok && r.option.id).toBe("B");
  });
});
