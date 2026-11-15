// The bot's personality: a preset the owner picks, plus optional notes in their own words.
// Shapes tone only; the safety and knowledge rules in the system prompts always apply.

export const PERSONALITIES = ["friendly", "professional", "playful", "expert", "concise"] as const;
export type Personality = (typeof PERSONALITIES)[number];

export const PERSONALITY_NOTES_MAX = 500;

type Preset = {
  label: string;
  /** Shown under the option in settings. */
  help: string;
  /** The style rule in the chat system prompt. */
  chat: string;
  /** How the suggestion bubbles should sound. */
  voice: string;
};

export const PERSONALITY_PRESETS: Record<Personality, Preset> = {
  friendly: {
    label: "Friendly (recommended)",
    help: "Warm, helpful and brief.",
    chat: "Be warm and brief: usually under 120 words. Use short paragraphs or a short list.",
    voice: "warm and friendly",
  },
  professional: {
    label: "Professional",
    help: "Polite and clear, like an experienced shop advisor. No slang or emoji.",
    chat: "Be polite, clear and professional, like an experienced shop advisor. No slang or emoji. Usually under 120 words, in short paragraphs or a short list.",
    voice: "polite and professional",
  },
  playful: {
    label: "Playful",
    help: "Cheerful, with a light touch of humour and the odd emoji.",
    chat: "Be cheerful and playful, with a light touch of humour; an occasional emoji is fine. Stay clear and helpful. Usually under 120 words, in short paragraphs or a short list.",
    voice: "cheerful and playful",
  },
  expert: {
    label: "Expert",
    help: "A knowledgeable specialist who explains the why behind the advice.",
    chat: "Be a knowledgeable specialist: explain the reasons behind your advice with concrete details from KNOWLEDGE. Usually under 180 words, in short paragraphs or a short list.",
    voice: "knowledgeable and expert",
  },
  concise: {
    label: "Short and direct",
    help: "Gets to the point in a sentence or three.",
    chat: "Be direct and to the point: answer in one to three sentences unless the visitor asks for more detail.",
    voice: "short and direct",
  },
};

export type PersonalitySettings = { personality: Personality; personalityNotes: string };

/** The chat system prompt's style rule, and the owner's notes when there are any. */
export function chatPersonality(s: PersonalitySettings): { rule: string; notes: string | null } {
  const notes = s.personalityNotes.trim();
  return { rule: PERSONALITY_PRESETS[s.personality].chat, notes: notes || null };
}

/** One line for the suggestion writer: how the "text" should sound. */
export function suggestionVoice(s: PersonalitySettings): string {
  const notes = s.personalityNotes.trim();
  const base = `Write "text" in a ${PERSONALITY_PRESETS[s.personality].voice} voice.`;
  return notes ? `${base} The shop describes the assistant's personality like this (tone only; the rules above still apply): ${notes}` : base;
}
