import type { WidgetStrings } from "@/shared/widget-protocol";

export const COPY: Record<"en" | "el", WidgetStrings & { defaultGreeting: string }> = {
  en: {
    disclosure: "You're chatting with an AI assistant. It can make mistakes, so please double-check important details.",
    defaultGreeting: "Hi! Questions about our products? I'm happy to help.",
    fallback: "I can't answer right now. Leave your email and your question, and the team will get back to you.",
    leadThanks: "Thanks, we'll be in touch soon.",
    open: "Open chat",
    close: "Close chat",
    placeholder: "Type your question…",
    send: "Send",
    emailLabel: "Your email",
    questionLabel: "Your question",
    poweredBy: "Powered by Concierge",
    dismissPrompt: "Dismiss suggestion",
  },
  el: {
    disclosure: "Συνομιλείτε με έναν βοηθό τεχνητής νοημοσύνης. Μπορεί να κάνει λάθη, γι' αυτό ελέγξτε τις σημαντικές πληροφορίες.",
    defaultGreeting: "Γεια σας! Έχετε ερωτήσεις για τα προϊόντα μας; Είμαι εδώ να βοηθήσω.",
    fallback: "Δεν μπορώ να απαντήσω αυτή τη στιγμή. Αφήστε το email και την ερώτησή σας και η ομάδα θα επικοινωνήσει μαζί σας.",
    leadThanks: "Ευχαριστούμε, θα επικοινωνήσουμε μαζί σας σύντομα.",
    open: "Άνοιγμα συνομιλίας",
    close: "Κλείσιμο συνομιλίας",
    placeholder: "Γράψτε την ερώτησή σας…",
    send: "Αποστολή",
    emailLabel: "Το email σας",
    questionLabel: "Η ερώτησή σας",
    poweredBy: "Με την υποστήριξη του Concierge",
    dismissPrompt: "Απόρριψη πρότασης",
  },
};

export function copyFor(language: string): (typeof COPY)["en"] {
  return language in COPY ? COPY[language as "en" | "el"] : COPY.en;
}
