---
name: oiloil-ui-ux-guide
description: Run a structured UI/UX consultation to either (a) co-design a project-specific design system and emit `design-spec.md`, (b) review an existing UI with prioritized fixes, or (c) emit compact do/don't rules for a surface. Triggers when the user wants to define / build / refine a design system or design tokens, asks for a design spec, asks for a full UI review of a screen / mockup / PR, or wants design rules for a surface type. Do NOT trigger for narrow one-off questions ("is this color OK?", "should this button be larger?") — answer those directly without invoking the consultation flow.
---

# OilOil UI/UX Guide (Starlight Launcher)

Starlight Launcher already has an established design system. Before running the consultation flow, **read the existing tokens first** — do not start from scratch.

## Existing Design Tokens (read these first)

- **Tailwind preset**: `packages/tooling-config/tailwind/tailwind-preset.ts`
- **Theme variables**: `packages/assets/styles/variables.scss` (light, dark, OLED variants)
- **Color token mappings** (CLAUDE.md):
  - `--gap-xs/sm/md/lg/xl` → `gap-1/2/3/4/6`
  - `var(--color-secondary)` → `text-secondary`
  - `var(--color-contrast)` → `text-contrast`
  - `var(--surface-N)` → `bg-surface-N` / `border-surface-N` (N = 1–5)
  - `var(--color-button-bg)` → `bg-button-bg`
  - `var(--color-divider)` → `border-divider`
  - `var(--radius-*)` → `rounded-[var(--radius-*)]`
- **Surface usage** (`packages/ui/AGENTS.md`):
  - `bg-surface-1` — deepest background layer
  - `bg-surface-1.5` — odd row background (tables)
  - `bg-surface-2` — even row background, secondary panels
  - `bg-surface-3` — headers, floating bar backgrounds, inputs
  - `bg-surface-4` — cards, elevated surfaces
  - `bg-surface-5` — borders, dividers
- **Text colors**:
  - `text-contrast` — primary headings
  - `text-primary` — default body text
  - `text-secondary` — reduced emphasis, secondary info

## Default Behavior

When triggered without an explicit mode, run `design`. Switch only when the user is explicit:

| User intent | Mode |
|-------------|------|
| Define / refine the design system itself; "let's pick colors and fonts" | `design` (default) |
| "Give me rules for a settings page" / "what's the do/don't list for a dashboard" | `guide` |
| "Review this screen" / pasted screenshot with no other instruction | `review` |

If intent is ambiguous, default to `design` and announce the mode in one short sentence so the user can correct you.

## Look Before You Ask

Spend 30 seconds scanning the project:
- `tailwind.config` / `theme.ts` / `globals.css` — what tokens exist
- `package.json` — what UI framework is used (Vue 3 + Tailwind v3, no shadcn/radix/chakra)
- Pick 2–3 real UI files to see actual font sizes, border radius, spacing
- If `design-spec.md` / `DESIGN.md` / `AGENTS.md` exists at root, **read it first**

This step is不可省. Not looking at code first means guessing — and often asking about things the project already decided.

## Project Stage Assessment

| Stage | Signals | Opening approach |
|-------|---------|------------------|
| **A. Blank** | Tailwind defaults, no custom tokens, few components | Full flow: vibe → tokens → business mock → spec |
| **B. Half-baked** | Tokens exist but scattered, inconsistent component styles | Consolidate existing + fill gaps, ask what to keep vs. what's makeshift |
| **C. Mature** | Complete tokens + clear naming + visual metaphor + audit traces | Acknowledge, list five intent branches for user to pick |
| **D. Complex legacy** | Multiple token sets, mixed new/old styles, no clear main line | Suggest `review` mode first for audit, then discuss refactor |
| **E. Unsure** | Scanned but uncertain | Describe what you see, ask if they want to stabilize or change direction |

## Opening Principles

1. **Use fact descriptions instead of self-introductions.** Describe project state ("you already have clear tokens"), not yourself ("I plan to X").
2. **Don't pile up code-observation details.** One summary sentence. Expand only if asked.

## Mode Workflows

### `design` mode (default)

Final output: `design-spec.md` at project root (including project-specific design validation).

1. **Phase 0 — Look at code + judge stage** (required). 30-second scan, place in one of five stages above.
2. **Phase 1 — Route by intent** — decide what the user actually wants: redefine direction, extend existing, export public spec, audit tweaks, or other.
3. **Phase 1b — Listen to details** — only for "redefine" or "extend". Ask product, brand assets, references, hard constraints, main language. No recommendations yet.
4. **Phase 2 — Find imagery** — only for "redefine". Give 2–4 style-family candidates from the project's existing style.
5. **Phase 3 — Pick concrete tokens** — color, font, radius, spacing, shadow, motion, plus container strategy, icon system, decoration, language. 2–3 options each, no starred recommendation.
6. **Phase 4a — Generic preview** — render 5 surfaces for quick "is this on track?" judgment. Exploration, not final.
7. **Phase 4b — Business mockup** — **the real final step**. Use final tokens to generate an independent HTML file for the user's **actual business page**. User signs off on their own business screen before proceeding.
8. **Phase 5 — Output** — only after user approves 4b, generate `design-spec.md`.

### `guide` mode — compact rules for a surface

1. Identify surface type (marketing / dashboard / settings / form / list-detail / content / mobile) and primary CTA.
2. Apply UX Hard Rules (below).
3. Apply system constraints from existing Starlight tokens.
4. If project has a known style family, apply that family's specifics; otherwise stay style-neutral.
5. Output: bullet do/don't list, no long paragraphs.

### `review` mode — prioritized fixes for existing UI

1. State assumptions (platform, target user, primary task) — one line each.
2. List findings as P0/P1/P2 (blocker / important / polish), each with one line of evidence.
3. For major issues, label diagnosis and apply HCI laws / cognitive biases when relevant.
4. Propose implementable fixes (layout, component, copy, state).
5. End with short verification checklist.

**Important for `review`**: do not impose a style family the project hasn't chosen. Critique against the project's own design language unless it has none.

## UX Hard Rules (style-independent)

1. **Task-first hierarchy** — primary task and primary CTA identifiable in <3 seconds.
2. **State coverage** — every interactive surface defines: loading, empty, error, success, permission-denied. Missing any one is a real bug.
3. **Affordance + signifier** — clickable things look clickable; primary actions labeled (icon-only only for universally-known actions); constraints shown before submit.
4. **Error prevention + recoverability** — constraints/defaults/inline validation over post-hoc errors; destructive actions reversible or need deliberate confirmation; error messages say what happened and how to fix.
5. **Feedback loop closure** — after any action, UI answers: "did it work?" + "what changed?" + "what's next?"
6. **Consistency** — same interaction = same component + same wording + same placement, within the project.
7. **CRAP for visual hierarchy** — Contrast / Repetition / Alignment / Proximity.
8. **Spacing scale** — pick a scale (4/8px base most common) and apply it; off-scale values need a reason.
9. **Help text layering** — L0 always visible → L1 nearby → L2 on demand → L3 after action. Many L0 hints = fix IA, not add text.
10. **UI copy source discipline** — visible copy from user tasks / system state / results, never from generation meta-text.

## When the User Pushes Back

Defer to user's stated preference *unless* it violates a UX Hard Rule. If it does:
- Name the rule at risk.
- Explain failure mode in concrete user terms.
- Offer one alternative preserving user's intent.
- If they still want it, do it. Hard rules are guidance, not gates.
