---
name: Concierge
description: Night-market signboard admin for a self-serve website chatbot, dark, ruled and lit only where something is live.
colors:
  ground: "#07070b"
  panel: "#0f0f16"
  well: "#181824"
  rule: "#262633"
  rule-strong: "#3a3a4c"
  control: "#5f5f78"
  ink: "#f2f2f5"
  ink-muted: "#a9a9ba"
  ink-subtle: "#9090a4"
  teal: "#08d9d6"
  sodium: "#ffd23f"
  sodium-hover: "#ffe07a"
  sodium-active: "#f2c21f"
  primary-ink: "#16120a"
  neon: "#ff2e63"
  neon-hover-ink: "#ffc2d1"
  danger: "#ff6b8f"
  ok: "#3ddc97"
  warn: "#ffa94d"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.05em"
  numeral:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.05em"
  brand:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.08em"
  sign:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  title:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.08em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  column-head:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.08em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  xs: "3px"
  sm: "4px"
  lg: "6px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  page-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.sodium}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "6.4px 14.4px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.sodium-hover}"
    textColor: "{colors.primary-ink}"
  button-primary-active:
    backgroundColor: "{colors.sodium-active}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "6.4px 14.4px"
    height: "36px"
  button-secondary-hover:
    textColor: "{colors.white}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "6.4px 14.4px"
  button-danger-hover:
    textColor: "{colors.white}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
  button-sm:
    padding: "4px 9.6px"
    height: "30.4px"
  button-icon:
    width: "32px"
    height: "32px"
    padding: "0"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
    height: "40px"
  sign:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.sign}"
    rounded: "{rounded.sm}"
    padding: "8.8px 12.8px"
    height: "44px"
  sign-hover:
    textColor: "{colors.neon-hover-ink}"
  sign-current:
    textColor: "{colors.neon}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  panel-head:
    textColor: "{colors.teal}"
    typography: "{typography.title}"
    padding: "8.8px 16px"
    height: "44px"
  stat:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.sodium}"
    typography: "{typography.numeral}"
    padding: "14.4px 17.6px 16px"
  stat-alert:
    textColor: "{colors.neon}"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.xs}"
    padding: "1.6px 7.2px"
  seg-current:
    backgroundColor: "{colors.well}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    padding: "6.4px 12.8px"
  lamp:
    backgroundColor: "{colors.ink-subtle}"
    rounded: "{rounded.pill}"
    size: "10px"
---

# Design System: Concierge

## Overview

**Creative North Star: "The Night-Market Sign Stack"**

The admin app, the owner console and the auth screens are a street of signboards at night. Navigation is a vertical stack of unlit sign boxes and the section you are in is the one switched on in red neon. Everything else is wet near-black ground, 1px-ruled sheet-metal panels and quiet grey ink, so the few lit things read instantly: the brand sign, the current section, a live lamp, a number, a problem. It deliberately refuses the category default of a white SaaS shell with a blue accent and soft cards.

The world serves an Operate mode for non-technical shop owners who check in for two minutes a few times a week. Density is moderate: panels stack in a single content column of up to 82rem with a 15rem rail, numbers are large and sodium-yellow so they can be read at a glance, and every panel carries the same teal header strip so the page reads as one system. Light is information, not decoration: glow appears only on something that is current, live or wrong, and the interface stays dark and still otherwise. The world is dark only, by decision; it never ships a light theme. The embeddable visitor widget is outside this world and keeps its own per-merchant theme.

**Key Characteristics:**
- Three surface values (ground, panel, well) separated by exactly-1px rules, never by shadows.
- Three tube colours with one job each: teal for links, panel heads, focus and data; sodium for numbers and the primary action; red neon for the lit sign and real critical state.
- Saira Condensed uppercase for anything that is a sign (headings, nav, panel heads, headline numbers, speaker labels); Geist for every sentence, label and control; Geist Mono only for URLs, hosts, snippets and keys.
- A signature tube-flicker on sign hover and focus; under reduced motion every animation is off.
- Measured WCAG AA everywhere: body ink 17.1:1, the quietest text 6.1:1, control boundaries 3.1:1 on panels.

## Colors

A near-black, faintly violet asphalt palette lit by three saturated tube colours, each confined to one job.

### Primary
- **Teal Tube** (teal): the system's working light. Links (with a 45%-alpha underline that goes solid on hover), every panel header strip, the focus ring and input focus glow, chart bars, meter fills, the live lamp, the brand mark, the bot's side of a transcript, the current segment underline. 10.8:1 on panels.

### Secondary
- **Sodium Lamp** (sodium): numbers and the primary action. Headline stat numerals, counts in lists, sale indicators and money, ordered-list markers on the install steps, and the background of the primary button (with near-black **Primary Ink** text at 12.9:1). Lighter **Sodium Hover** on hover, deeper **Sodium Active** when pressed. 13.2:1 on panels.

### Tertiary
- **Red Neon** (neon): the lit sign and nothing else except genuine critical state: the current nav sign, an alert stat numeral, the critical lamp, a full meter, the border of critical notices and danger panels, the hover fill of destructive buttons. 5.3:1 on panels, so it is used for large sign text and borders, never small body text.
- **Danger Pink** (danger): the readable text form of red for critical copy: danger panel heads, destructive button labels, critical badges, invalid-field borders. 7.1:1 on panels.
- **Neon Hover Ink** (neon-hover-ink): the half-lit pink of a sign under hover or focus, before it is current.
- **Status Green** (ok) and **Warning Amber** (warn): lamps, badges and notice borders for healthy and warning states; amber also marks a toggle that is switched on (aria-pressed). 10.8:1 and 10.0:1 on panels.

### Neutral
- **Wet Ground** (ground): the page, the inside of inputs and code blocks, unlit sign boxes and the meter track. Lifted at the foot of the page by two fixed radial gradients: a violet asphalt reflection (rgb 36 30 74 at 55%) and a faint neon spill (rgb 255 46 99 at 7%).
- **Sheet Metal** (panel): panels, cards, stat cells, notices, the auth panel, usually at 88-92% opacity over the ground.
- **Recessed Well** (well): inline code, file-picker buttons, the current segment, hovered table rows and site rows.
- **Hairline Rule** (rule): every 1px divider and panel border. **Strong Rule** (rule-strong): unlit sign borders, table header underline, badge and segment borders, meter track border.
- **Control Edge** (control): the 3.1:1 boundary of inputs, selects, secondary buttons and file pickers.
- **Ink** (ink), **Muted Ink** (ink-muted), **Subtle Ink** (ink-subtle): body text at 17.1:1, secondary text and stat labels at 8.2:1, hints, table headers, placeholders and unlit signs at 6.1:1. Pure **White** (white) is reserved for hovered and current controls and bold text inside notices.

### Named Rules
**The One Lit Sign Rule.** Red neon marks the section you are in and real critical state. Nothing decorative is ever red, and row-level destructive buttons stay unlit until reached so no row out-shouts the current sign.

**The One Job Per Tube Rule.** Teal is for links, panel heads, focus and data; sodium is for numbers and the primary action; neon is for the lit sign and critical state. A colour never borrows another tube's job.

**The Glow Means Live Rule.** Glow (text-shadow or box-shadow bloom) appears only on something lit: the brand mark, the current sign, a live or alert lamp, an alert numeral, a filled meter, a focused input, a hovered chart day. Static content never glows.

## Typography

**Display Font:** Saira Condensed (with Arial Narrow, sans-serif), weights 600, 700, 800
**Body Font:** Geist (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace)

**Character:** A tall, condensed signboard face set in tracked uppercase does all the shouting, while a neutral grotesque does all the reading. The mono face appears only where the text is machine text.

### Hierarchy
- **Display** (Saira Condensed 800, 2.5rem, 2rem at 640px and below, line-height 1, uppercase, 0.05em): the page title (site name, Usage, Accounts). Auth screens use the same face at 1.875rem. The host or URL sits beneath in mono.
- **Numeral** (Saira Condensed 800, 2.75rem, line-height 1, 0.02em, tabular): headline stat values in sodium; red neon with glow when alerting.
- **Headline** (Saira Condensed 700, 1.5rem, line-height 1.1, uppercase, 0.05em): section headings in the content column, such as "Overview · Last 30 days".
- **Brand** (Saira Condensed 800, 1.75rem, 1.35rem in the phone strip, 0.08em, teal with glow): the CONCIERGE wordmark, the only always-lit sign.
- **Sign** (Saira Condensed 700, 1.125rem, 1rem on phones, line-height 1, uppercase, 0.08em): nav signs; quiet signs (back link, Usage, Sign out) at 0.95rem.
- **Title** (Saira Condensed 600, 1rem, line-height 1.15, uppercase, 0.08em, teal): every panel and card header strip; transcript speaker labels use the same voice at 0.875rem.
- **Body** (Geist 400, 0.9375rem, line-height 1.55): all running text; long prose capped at 72ch.
- **Body Small** (Geist 500, 0.875rem): buttons, form labels, table cells.
- **Label** (Geist 400, 0.8125rem): stat labels, notes, field hints, segmented control.
- **Column Head** (Geist 500, 0.75rem, 0.08em, uppercase, subtle ink): table headers and phone stacked-row cell labels.
- **Mono** (Geist Mono, 0.8125rem, or 0.875em inline): URLs, hosts, paths, snippets, keys.

### Named Rules
**The Signboard Face Rule.** Saira Condensed is only for things that are signs: headings, nav, panel heads, headline numbers, speaker labels. Sentences, labels, form fields and buttons are always Geist.

**The Controls Speak Plain Rule.** A button, link, select or badge placed inside a header strip or speaker label drops back to Geist, sentence case, normal tracking.

**The Machine Text Rule.** Geist Mono appears only on text a machine produced or will consume: URLs, hosts, paths, the embed snippet, keys.

## Layout

Desktop is a two-column shell: a sticky, full-height 15rem rail (the sign stack) on the left with a right rule, and a content column capped at 82rem with 2rem top, 2.25rem side and 4rem bottom padding. Account-wide banners (quota) run full width as a ruled bar above the content. The rail holds the brand mark, an optional quiet back sign, a small group label, the stacked signs at 0.45rem intervals, and a foot (Usage, Sign out) pushed to the bottom behind a rule.

At 860px and below the shell collapses: the rail becomes a sticky, blurred top bar with the brand mark left and the foot controls right, and the signs become a single horizontally scrolling strip beneath, edge-faded on the right, which scrolls the current sign into the centre on navigation. Content padding drops to 1.25rem 1rem 3rem.

Inside the content column, panels stack with 1.5-2rem gaps and sit in grids where comparison helps: a 2-up-to-4 stat strip, a 1.7fr / 1fr chart beside the start-pages list, a main column beside a 20rem side column on detail pages. Spacing follows a 4px rhythm (4, 8, 12, 16, 24, 32). Tables scroll horizontally inside their panel with teal edge shadows only on the side that has more to reveal; at 640px and below list tables become stacked rows (a lead line, a full-width preview line, then one wrapping meta line with inline column labels). At 480px the chart drops its minor ticks.

### Named Rules
**The Transcript Owns Its Column Rule.** A conversation transcript takes the main column alone; metadata (email, pages visited) sits in a side column on desktop and below it on phones, never interleaved with messages.

## Elevation & Depth

The system is flat and tonal. Depth comes from three surface values over a lit ground and from 1px rules, and emphasis comes from light (glow), not from lift. There is no shadow scale. The few box-shadows that exist are either neon or teal blooms on lit things, or one ambient neon bloom under the auth panel.

### Shadow Vocabulary
- **Neon glow** (`0 0 6px rgb(255 46 99 / 0.75), 0 0 18px rgb(255 46 99 / 0.35)`): text-shadow on the current sign and alert numerals; also on the critical lamp and full meter.
- **Teal glow** (`0 0 6px rgb(8 217 214 / 0.7), 0 0 16px rgb(8 217 214 / 0.3)`): the brand mark, the live lamp, the meter fill.
- **Current sign** (`0 0 18px -4px rgb(255 46 99 / 0.6), inset 0 0 14px -6px rgb(255 46 99 / 0.7)`): the tube light inside and around the lit sign box.
- **Input focus** (`0 0 0 1px #08d9d6, 0 0 14px -2px rgb(8 217 214 / 0.45)`): a focused field.
- **Primary hover** (`0 6px 20px -8px rgb(255 210 63 / 0.6)`): sodium spill under a hovered primary button.
- **Auth bloom** (`0 24px 60px -30px rgb(255 46 99 / 0.35)`): the single signed-out panel.

### Named Rules
**The Hairline Rule.** Every rule and border is exactly 1px, and there are only three surface values (ground, panel, well). Separation is drawn, never shaded.

**The Light, Not Lift Rule.** In-app panels, cards and notices carry no drop shadow; something becomes prominent by being lit.

## Shapes

Sheet-metal geometry: rectangles with barely softened corners. Controls, signs, segments and code blocks take 4px; containers (panels, cards, notices, stat strip, transcript messages, auth panel) take 6px; badges and inline code take 3px. Fully round shapes are reserved for status lamps and meters. Full-width notice bars are square. Chart bars have 4px rounded tops and square baselines. The stat strip is one ruled box whose cells are divided by 1px gaps showing the rule colour beneath.

### Named Rules
**The Sheet-Metal Corner Rule.** 4px for anything you operate, 6px for anything that contains, round only for lamps and meters. No pills, no large radii.

## Components

### Buttons
Unlit outlined boxes that light up teal on contact; only the primary action is solid.
- **Shape:** gently squared (4px), 2.25rem minimum height, 0.4rem 0.9rem padding, Geist 500 at 0.875rem, icon gap 0.4rem.
- **Primary:** sodium fill and border, Primary Ink text, weight 600. One per form or work area: the action that area exists for (Save, Add, Copy snippet, Sign in).
- **Secondary (default button):** transparent with a Control Edge border and Ink text. Hover turns the border teal, the text white and adds a 7% teal wash; active deepens it to 14%.
- **Hover / Focus:** 160ms transitions on the expo-out ease; focus is a 2px teal outline offset 2px.
- **Danger:** Danger Pink text with a 60% pink border; hover lights the border red neon with a 14% neon wash and white text. **Quiet danger** for row-level actions looks like a secondary button until hovered or focused, then lights the same way.
- **Ghost:** no border, Muted Ink text (dismiss controls). **Small:** 1.9rem high, 0.8125rem text. **Icon:** 2rem square.
- **Toggle on (aria-pressed):** amber border and text.
- **Disabled:** 50% opacity, not-allowed cursor.

### Chips / Badges
- **Style:** 3px corners, 1px Strong Rule border, Muted Ink text at 0.75rem, no fill.
- **State:** ok, warn and critical variants tint only the border and text (green, amber, Danger Pink).

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** Sheet Metal at 88% over the ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Hairline Rule; danger variants use a 45% neon border with a Danger Pink header.
- **Header strip:** every panel opens with the same strip: 2.75rem tall, 0.55rem 1rem padding, a bottom rule, teal Saira Condensed uppercase at 1rem. Controls inside it (Refresh, filters) sit right-aligned in plain Geist.
- **Internal Padding:** 1rem for panels; settings cards 1.1rem with a 1rem gap between fields.

### Inputs / Fields
- **Style:** recessed wells: Wet Ground fill, 1px Control Edge border, 4px corners, 0.5rem 0.625rem padding, 2.5rem minimum height; selects carry a muted chevron. Checkboxes and radios use teal accent colour.
- **Focus:** the border turns teal with a 1px teal ring and a soft teal bloom.
- **Error / Disabled:** invalid fields take a Danger Pink border; disabled fields drop to 55% opacity. Labels are Ink at 0.875rem weight 500, hints Subtle Ink at 0.8125rem.

### Navigation
- **The sign stack (signature):** each section is a sign box: 2.75rem tall, Strong Rule border, translucent ground fill, Subtle Ink Saira Condensed uppercase at 1.125rem. Hover or focus half-lights it (pink ink, 55% neon border, faint text glow) with a 200ms stepped tube-flicker; the current section is fully lit in red neon with border, text glow and inner and outer bloom, and does not flicker. Quiet signs (back to all websites, Usage, Sign out) have no box. On phones the stack is a horizontally scrolling strip.
- **Segmented control:** a 4px ruled group of Geist 0.8125rem links (date range); the current one is white on the well with a 2px teal underline.
- **Tabs:** plain Geist links 1.5rem apart over a bottom rule; current is white with a 2px teal underline.

### Stat Strip
A single ruled box of 1px-divided cells, each with a Muted Ink label, a sodium Saira numeral, an optional Subtle Ink note saying what the number counts, and an optional link to the fix. An alert cell turns its numeral red neon with glow.

### Status Lamps and Notices
- **Lamps:** 10px round dots: grey idle, green ok, amber warn, red neon critical with a ring, teal live with a 1.6s pulse.
- **Notices:** a 6px ruled box with a leading lamp, tinted at 6-8% in the state colour with a 40-55% border; strong text inside is white. The full-width notice bar is square and ruled only at the bottom. Success notices can be dismissed with a ghost icon button.

### Transcript
Each message is a 6px ruled box with a Saira uppercase speaker label and a plain Geist timestamp. Bot messages are tinted 4.5% teal with a teal speaker label; visitor messages sit on Sheet Metal with a Muted Ink label.

### Daily Bar Chart
A server-rendered SVG inside a standard panel: teal bars with 4px rounded tops, three faint gridlines (zero line stronger), 11px muted tick labels, a native tooltip per day, a teal drop-shadow glow on the hovered day, and a visually hidden table of the same numbers. Bar heights encode value exactly from a zero baseline.

### Meter
An 8px round track on the ground with a Strong Rule border; the fill is teal with glow, amber at warning (no glow), red neon with glow when full.

## Do's and Don'ts

### Do:
- **Do** keep every border and divider at exactly 1px and build depth from the three surfaces: ground, panel, well.
- **Do** light exactly one nav sign per page in red neon, the section the owner is in.
- **Do** set every headline number in sodium Saira Condensed with a label and a note saying what it counts and over what period.
- **Do** open every panel with the teal Saira Condensed header strip, and keep controls inside it in plain Geist.
- **Do** give each form or work area at most one sodium primary button, for the action it exists for; everything else is the outlined secondary button.
- **Do** use the authored 16px icon set (1.6 stroke, currentColor, round caps), decorative unless labelled.
- **Do** keep text at or above the measured contrasts: Ink 17.1:1, Muted 8.2:1, Subtle 6.1:1 on panels, and control boundaries at 3.1:1.
- **Do** turn every animation off and make transitions instant under prefers-reduced-motion.

### Don't:
- **Don't** ship a light theme or light panels; this world is dark only by decision.
- **Don't** use red neon for decoration, emphasis or ordinary destructive rows at rest; it is the lit sign and real critical state only.
- **Don't** put glow on static content; glow is reserved for things that are current, live or alerting.
- **Don't** add drop shadows to in-app panels, cards or notices; the auth panel's neon bloom is the single exception.
- **Don't** set sentences, labels, form fields or buttons in Saira Condensed, and don't use Geist Mono for anything but URLs, hosts, snippets and keys.
- **Don't** set small body text in red neon (5.3:1); use Danger Pink for critical copy.
- **Don't** round controls past 4px or containers past 6px, and don't use pill buttons.
- **Don't** apply this world to the embeddable visitor widget; it keeps its own per-merchant theme.
