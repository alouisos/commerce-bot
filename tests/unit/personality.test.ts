import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { PERSONALITIES, PERSONALITY_PRESETS, suggestionVoice } from "@/lib/chat/personality";
import { EAGER_RULE, promptSystem, PROMPT_SYSTEM } from "@/lib/prompts/writer";

const site = { botName: "Mira", name: "Olive & Co", guardrails: "Never offer discounts.", personalityNotes: "" };

describe("personality in the chat prompt", () => {
  it("friendly keeps the original style rule", () => {
    const p = buildSystemPrompt({ ...site, personality: "friendly" });
    expect(p).toContain("- Be warm and brief: usually under 120 words. Use short paragraphs or a short list.");
    expect(p).not.toContain("Your personality");
  });

  it("uses each preset's rule in place of the default one", () => {
    for (const personality of PERSONALITIES) {
      const p = buildSystemPrompt({ ...site, personality });
      expect(p).toContain(`- ${PERSONALITY_PRESETS[personality].chat}`);
      if (personality !== "friendly") expect(p).not.toContain("Be warm and brief");
    }
  });

  it("adds the owner's notes after the rules and before the guardrails, as tone only", () => {
    const p = buildSystemPrompt({ ...site, personality: "playful", personalityNotes: "  Loves a coffee pun.  " });
    const notes = p.indexOf("Loves a coffee pun.");
    expect(notes).toBeGreaterThan(p.indexOf("Rules:"));
    expect(notes).toBeLessThan(p.indexOf("The shop's own rules"));
    expect(p).toContain("It shapes your tone only; the rules above always apply:\nLoves a coffee pun.");
  });
});

describe("personality in suggestions", () => {
  it("adds the voice line before the guardrails", () => {
    const voice = suggestionVoice({ personality: "professional", personalityNotes: "" });
    expect(voice).toBe('Write "text" in a polite and professional voice.');
    const s = promptSystem("No medical claims.", { voice });
    expect(s.startsWith(PROMPT_SYSTEM)).toBe(true);
    expect(s.indexOf(voice)).toBeLessThan(s.indexOf("No medical claims."));
  });

  it("carries the owner's notes", () => {
    expect(suggestionVoice({ personality: "expert", personalityNotes: "A herbalist." })).toContain(
      "(tone only; the rules above still apply): A herbalist.",
    );
  });
});

describe("proactive help", () => {
  it("every chat prompt asks for one useful next step", () => {
    const p = buildSystemPrompt({ ...site, personality: "concise" });
    expect(p).toContain("- Be proactively helpful. After answering, offer one useful next step");
    expect(p).toContain("Skip it when the visitor only wanted a quick fact.");
  });

  it("Active and Eager suggestion writers prefer to show something", () => {
    expect(promptSystem("", { eager: true })).toContain(EAGER_RULE);
    expect(promptSystem("")).not.toContain(EAGER_RULE);
    // Still before the shop's own rules.
    const s = promptSystem("No medical claims.", { eager: true });
    expect(s.indexOf(EAGER_RULE)).toBeLessThan(s.indexOf("No medical claims."));
  });
});
