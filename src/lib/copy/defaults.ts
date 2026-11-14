import type { WidgetStrings } from "@/shared/widget-protocol";

export const COPY: Record<"en" | "el", WidgetStrings & { defaultGreeting: string }> = {
  en: {
    disclosure: "AI can make mistakes. Check important info.",
    continueChat: "Continue our conversation",
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
    consentAsk: "Want me to email you personalised recommendations based on what we talked about?",
    consentFine:
      "By sending your email you agree to receive personalised emails from {site} based on this chat and the pages you viewed. You can unsubscribe at any time.",
    consentYes: "Yes, email me",
    consentNo: "No thanks",
    consentThanks: "Thanks! Check your inbox to confirm.",
  },
  el: {
    disclosure: "Η τεχνητή νοημοσύνη μπορεί να κάνει λάθη. Ελέγξτε τις σημαντικές πληροφορίες.",
    continueChat: "Συνεχίστε τη συζήτησή μας",
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
    consentAsk: "Θέλετε να σας στείλω με email εξατομικευμένες προτάσεις με βάση όσα συζητήσαμε;",
    consentFine:
      "Στέλνοντας το email σας, συμφωνείτε να λαμβάνετε εξατομικευμένα email από το {site} με βάση αυτή τη συζήτηση και τις σελίδες που είδατε. Μπορείτε να διαγραφείτε όποτε θέλετε.",
    consentYes: "Ναι, στείλτε μου",
    consentNo: "Όχι, ευχαριστώ",
    consentThanks: "Ευχαριστούμε! Ελέγξτε τα εισερχόμενά σας για επιβεβαίωση.",
  },
};

export function copyFor(language: string): (typeof COPY)["en"] {
  return language in COPY ? COPY[language as "en" | "el"] : COPY.en;
}

/** Server-side copy for the emails and pages a subscriber sees. `{site}` is the site's name. */
export const EMAIL_COPY = {
  en: {
    confirmSubject: "Please confirm your email for {site}",
    confirmBody: "Please confirm that you'd like personalised recommendations from {site} by email:",
    confirmButton: "Confirm my email",
    confirmPrompt: "Confirm that you'd like personalised recommendations from {site} by email.",
    confirmed: "You're subscribed to {site}.",
    invalidLink: "This link has expired or isn't valid.",
    unsubscribeButton: "Unsubscribe",
    unsubscribePrompt: "Stop receiving emails from {site}?",
    unsubscribed: "You're unsubscribed from {site}.",
    footer: "You're getting this because you asked {site} for recommendations. Unsubscribe:",
    buyerFooter: "You're getting this because you bought from {site}. Unsubscribe:",
    buyerFeedback: "Tell us what you think of your purchase",
    feedbackTitle: "How is your purchase?",
    feedbackProducts: "Your order from {site}:",
    feedbackRating: "Your rating",
    feedbackStars: "{n} out of 5",
    feedbackComment: "Anything to add? (optional)",
    feedbackSubmit: "Send feedback",
    feedbackThanks: "Thank you for your feedback!",
    feedbackEdit: "You can change your answer and send it again.",
  },
  el: {
    confirmSubject: "Επιβεβαιώστε το email σας για το {site}",
    confirmBody: "Επιβεβαιώστε ότι θέλετε να λαμβάνετε εξατομικευμένες προτάσεις από το {site} με email:",
    confirmButton: "Επιβεβαίωση του email μου",
    confirmPrompt: "Επιβεβαιώστε ότι θέλετε να λαμβάνετε εξατομικευμένες προτάσεις από το {site} με email.",
    confirmed: "Η εγγραφή σας στο {site} ολοκληρώθηκε.",
    invalidLink: "Ο σύνδεσμος έχει λήξει ή δεν είναι έγκυρος.",
    unsubscribeButton: "Διαγραφή",
    unsubscribePrompt: "Να σταματήσετε να λαμβάνετε email από το {site};",
    unsubscribed: "Διαγραφήκατε από το {site}.",
    footer: "Λαμβάνετε αυτό το email επειδή ζητήσατε προτάσεις από το {site}. Διαγραφή:",
    buyerFooter: "Λαμβάνετε αυτό το email επειδή αγοράσατε από το {site}. Διαγραφή:",
    buyerFeedback: "Πείτε μας τη γνώμη σας για την αγορά σας",
    feedbackTitle: "Πώς είναι η αγορά σας;",
    feedbackProducts: "Η παραγγελία σας από το {site}:",
    feedbackRating: "Η βαθμολογία σας",
    feedbackStars: "{n} στα 5",
    feedbackComment: "Θέλετε να προσθέσετε κάτι; (προαιρετικό)",
    feedbackSubmit: "Αποστολή",
    feedbackThanks: "Ευχαριστούμε για τα σχόλιά σας!",
    feedbackEdit: "Μπορείτε να αλλάξετε την απάντησή σας και να την στείλετε ξανά.",
  },
} as const;

export type EmailCopy = (typeof EMAIL_COPY)["en"];

export function emailCopyFor(language: string): { language: "en" | "el"; copy: Record<keyof EmailCopy, string> } {
  const l = language === "el" ? "el" : "en";
  return { language: l, copy: EMAIL_COPY[l] };
}

export const fillSite = (text: string, site: string) => text.replaceAll("{site}", site);
