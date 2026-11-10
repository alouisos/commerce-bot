---
version: 1
slug: "src-app-app-layout-tsx"
primary_target: "src/app/app/layout.tsx"
related_targets: ["src/app/owner/layout.tsx","src/app/(auth)/sign-in/page.tsx"]
---

# Surface: Concierge admin (app, owner console, auth)

Scope: `/app/**`, `/owner/**`, `/(auth)/**`, `/invite/**`. Mode: Operate. The embeddable widget is out of scope.
Audience and job: non-technical small-shop owners, a few visits a week on laptop or phone, checking conversations, leads, sales and fixing what the bot could not answer. Constraint: WCAG AA text and control contrast; reduced motion honoured; existing tests stay green.

## Direction contract

THESIS: Navigation is a vertical stack of night-market signboards and the section you are in is the one switched on in red neon. It refuses the category default of a white SaaS shell with a blue accent and soft cards.

OWN-WORLD: Wet near-black ground (#07070b) with a faint asphalt reflection low on the page; panels are 1px-ruled sheet-metal boxes (#0f0f16, rule #24242f) each with the same header strip set in Saira Condensed caps in teal tube colour (#08d9d6). Numbers glow sodium yellow (#ffd23f); red neon (#ff2e63) marks only the lit sign and real critical state. Geist for every label and body line, Geist Mono only for URLs, snippets and keys. Neon glow lives only on live or active things. Raised from Factory sleeve: neon only on the active item. Raised from centre-rail: every rule exactly 1px, three surface values. Raised from Japanese dense web: one header-strip convention on every panel. Raised from labanotation: bars encode value exactly. Raised from vertical feed: a transcript owns its column.

STORY: The owner lands on Websites, sees each site's status lamp, opens one, and the sign stack tells them where they are; overview numbers say what they count and over what period, problems glow red with a plain fix action.

FIRST VIEWPORT: Left, a 220px sign-stack rail: CONCIERGE wordmark in teal neon, the site's sections as stacked sign boxes, current one lit red; Usage and Sign out at its foot. Right, the site name in large condensed caps with host below, the date-range segmented control top-right, a four-column ruled stat strip with sodium numerals, then a daily bar chart (teal bars) beside the start-pages list. Primary action (sodium yellow button) sits in the top bar of each work area.

FORM: Night-Market Sign Stack, my own grounded list position 1 (taken as IMPECCABLE'S PICK). seed:edbb354bf8fc84b4. Signature interaction: hovering or focusing a sign tube-flickers it on at half brightness for 180ms before steadying; the current sign holds full glow; under reduced motion the change is instant. On phones the stack becomes a horizontally scrolling sign strip under the header.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
