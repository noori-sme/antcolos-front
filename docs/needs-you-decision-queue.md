# Needs You — a decision queue, not a work queue

This documents the redesign of `/needs-you`: what the screen now claims, where
each claim is enforced, and the rules a new work type has to follow to appear
there.

Nothing here is a backend. Where this says "the system collected quotes" it
means the mock adapter derives them from records this frontend already holds —
the seam is typed so a real orchestrator can attach the same record.

---

## 1. The rule

**An item may appear on Needs You only when everything that can run unattended
already has, and the only step left is one a rule must not take for somebody.**

Three kinds of step qualify as "must not be automated":

* a commitment of money (bind a policy, accept a rate, book a load);
* a commitment to a person (start somebody, decline an applicant);
* a judgement about identity (is this imported row the driver we already have?).

Everything on either side of that step is the system's: finding the condition,
resolving the record, contacting the broker, collecting and ranking the quotes,
then — after the press — binding, filing, replacing the document and updating
compliance.

## 2. What an item carries

`NeedsYouItem.automation` (`src/types/needs-you.ts`):

| Field | What it is |
|---|---|
| `stage` | `awaiting_decision` · `executing` · `done` · `handoff` |
| `stepsDone` / `stepsTotal` | The meter on the row. A person's share is one step |
| `prework[]` | What already ran. Five-word labels; the sentence is on hover |
| `options[]` | The pre-analysed choices. One press each |
| `decision` | Who chose what, and every downstream step that ran after |

An option carries `metrics` **only where a real record backs them**. The three
renewal quotes are priced off the expiring policy's own premium, its own primary
limit and its own insurer, read through the insurance registry with the caller's
context — so a membership without `insurance:sensitive:view` gets no premium
column rather than a blank one. Work types with no comparable figures get
options that name what will happen instead of a number nobody could check.

## 3. Where it is decided

| Concern | File |
|---|---|
| The shape | `src/types/needs-you.ts` |
| The playbooks, the quote market, execution | `src/lib/api/mock/needs-you-automation.ts` |
| Attachment to every queue read, and `decide` | `src/lib/api/mock/needs-you.ts` |
| The contract a real API must meet | `src/lib/api/contracts/needs-you.ts` |
| The row, the meter, the options | `src/features/needs-you/{item-card,decision}.tsx` |

`attachAutomation` is the single seam. A module that learns to raise a new work
type gets a working decision row without touching this file; a work type that
deserves a real playbook gets one by being named in `PLAYBOOKS`. A category with
no playbook falls back to its own `recommendedAction` — still one press, just
without domain pre-work it cannot stand behind.

`decide(ctx, id, { optionId })` re-plans through the same seam a read uses, so an
option a domain supplied (a quote) is executable, records the decision on the
item's history, and runs every downstream step the option promised.

## 4. Items that are a view of another module's state

A derived item (`item.derived`) has nothing here to write to — approving it
would hide the row without moving the thing it is about. Those items get exactly
one option, of intent `open`, and it is a link straight to where the record is
fixed. Still one press; it just lands in the module that owns it. The service
refuses `decide` on them with the sentence a person should read.

## 5. What the screen does not do

* No paragraph in a row. The reason is on hover and in the drawer.
* No multi-step form. The drawer offers the same options the row does, so
  opening it is never the way to find the real button.
* No invented figure. See §2.
* No claim about a person. Who holds a row comes from the responsibility layer,
  as before.

## 6. Tests

| Claim | Test |
|---|---|
| Every work type lands on one press; pre-work labels stay short | `src/lib/api/mock/needs-you-automation.test.ts` |
| Derived items are links, and refuse to be decided here | same |
| Every queued item arrives pre-analysed; quotes are priced off the policy and hold still between reads | `tests/needs-you-automation.test.ts` |
| A press closes the item and records what ran; permissions are enforced | same |
| A row carries its own decision control, and pressing it finishes the item in place | `tests/browser/needs-you-decisions.spec.ts` |
| Filters, sort, views and the phone layout still behave | `tests/browser/needs-you-{filters,mobile}.spec.ts` |
