---
paths:
  - "src/components/**"
  - "src/features/**/*.tsx"
  - "src/app/**/*.tsx"
  - "src/styles/**"
description: UI, design system, states, forms, accessibility
---

## Design system

- Colors, radius, elevation, and density come from tokens in `src/styles/globals.css`
  (`bg-surface`, `text-fg-muted`, `border-border`, `bg-st-danger-bg`, `shadow-e1`, …).
  Never use raw hex/oklch/`bg-red-500` in components. A new token goes into `globals.css`
  (light **and** dark) first.
- Start from the primitives in `src/components/ui` (Button, Badge, Card, Dialog, Sheet,
  Field, Input, ConfirmDialog, Tooltip, Skeleton). Add a primitive there before you
  hand-roll one in a feature. Variants go through `class-variance-authority`, and class merging
  through `cn()` from `@/lib/utils`.
- Status chips use `src/components/common/status-badge.tsx` + `src/config/statuses.ts`. Don't
  restyle a status inline per screen.
- Page structure is `<PageHeader title description actions />` from `@/components/layout`,
  then content in `space-y-section`.

## States: every data view handles all four

- Loading: `<LoadingSkeleton />` from `@/components/data/states` (card-style rows:
  `rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1`, a title line and a
  subtitle line on the left, a badge placeholder on the right). Never use flat solid bars or a bare spinner for lists.
- Empty: `<EmptyState>` with one next action, gated by `<Can>`.
- Error: `<ErrorState>` with `error.message` and a retry that calls `refetch`.
- Success: the data. A forbidden action is hidden (`<Can>`) or shown disabled with a reason.
  Never show it enabled and let the API refuse it.

## Forms

- Use react-hook-form + zod (`@hookform/resolvers/zod`). The schema sits next to the form and
  mirrors the contract's validation (required, lengths, formats), so the client never accepts
  what the server rejects.
- Submit buttons disable while pending. Show server errors from the mutation's `error.message`
  near the submit. Toast success (`sonner`) only for actions with no visible result.
- Destructive actions go through `<ConfirmDialog>`.

## Design skills: which one, when

This repo already has a design system (`globals.css` tokens + `components/ui`). Use skills
that work **inside** it. Don't use ones that bring their own look.

| Task | Skill |
| --- | --- |
| New component/pattern, or auditing for hardcoded values and naming drift | `design:design-system` |
| Polishing a screen (spacing, type, borders, motion, hit areas, interaction states) | `ecc:make-interfaces-feel-better` |
| Reviewing a finished screen or a screenshot | `design:design-critique` |
| Accessibility while building / auditing before merge | `ecc:frontend-a11y` / `design:accessibility-review` |
| Empty states, errors, CTAs, confirmations, onboarding text | `design:ux-copy` |
| Figma → build spec | `design:design-handoff` (needs the Figma connector authorized) |

Don't use these for product screens: `ecc:frontend-design-direction` and the `frontend-design`
plugin (they set their own aesthetic and would fight the tokens; use them only for a surface with
no existing design, such as a marketing page, and only when the user asks), `ecc:gan-design` (long autonomous
loops), and `ecc:taste` (video). Whatever a skill suggests, tokens and primitives win. A new
visual value goes into `globals.css` (light and dark) first, never inline.

## Behavior and a11y

- Navigate with `<Link>` / `useRouter()`. Don't use `window.location` (lint flags it). The only
  exceptions are the forced-logout paths in `src/lib/api/client.ts`.
- Interactive elements are real `<button>`/`<a>` with accessible names. Icons are
  `aria-hidden` (lucide). Dialogs come from Radix, so don't hand-roll focus traps.
- Layouts work at 360 px (the `mobile` Playwright project is Pixel 7). There is no horizontal page
  scroll. Tables collapse or scroll inside their own container.
- Use framer-motion sparingly and respect `prefers-reduced-motion`.
