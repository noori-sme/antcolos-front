---
name: requirements
description: Stage 1 of the Antcolos frontend lifecycle. Turn an idea, ticket, or backend contract into docs/requirements/<feature>.md (screens, states, permissions, API mapping, acceptance criteria, backend gaps). Use before /feature, or whenever the user describes a new screen or flow.
argument-hint: "<feature name, ticket, or path to a backend contract doc>"
---

# Requirements

Output: `docs/requirements/<feature>.md` from [template.md](template.md), with no open
questions that would change the design. You write no code in this stage.

## 1. Gather sources (read only what exists)

- The user's description or ticket. If the ECC `/jira` skill is configured, pull the ticket.
- Backend: `../antcolos/docs/requirements/<feature>.md` (business rules) and
  `<feature>-api-contract.md` (endpoints, fields, errors, permissions). List what exists with
  `ls ../antcolos/docs/requirements/`. If the backend has a plan in progress, check
  `../antcolos/docs/plans/` (highest NN) for its status.
- Frontend: an existing `docs/requirements/<feature>.md`, the relevant `docs/*.md` design
  record, and the current screen (`src/features/<x>/`) if one exists, including whether it
  runs on mock or http today.
- Product principles: `../antcolos/docs/product/cmos-product-reference.md` §2, only if
  the feature introduces a new entity or workflow.

## 2. Draft the document

Fill every section of the template. Rules:
- Every screen lists its **four states** (loading, empty, error, success) and its
  **permission gate** (permission keys, not roles).
- Every user action maps to **one contract endpoint** (method + path + permission +
  idempotent?). An action with no endpoint goes under **Backend gaps**, not into the design.
- Acceptance criteria are testable statements ("A dispatcher without `trucks:create` does not
  see Add truck"). Each one names the tier that will prove it (unit, browser).
- Don't invent business rules. Anything unstated goes under **Open questions**.

## 3. Resolve questions

Ask all open questions **in one batch** (AskUserQuestion when there are 4 or fewer, otherwise a
numbered list). Write the answers back into the doc. If a backend gap blocks the feature,
say so plainly and offer the choices: wait, build on mock behind the contract, or descope.

Exit: the doc is saved, open questions are resolved or explicitly deferred, and backend gaps
are listed. Next step: `/feature docs/requirements/<feature>.md` (or `/integrate` when the
work is only wiring existing endpoints).
