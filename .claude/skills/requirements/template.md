# <Feature> — frontend requirements

Status: draft | agreed | implemented · Owner: <name> · Updated: <YYYY-MM-DD>
Backend contract: `../antcolos/docs/requirements/<feature>-api-contract.md` (v<…>, status <…>)

## 1. Goal
One paragraph: who this is for and what they can do afterwards that they can't do today.

## 2. Actors and permissions
| Actor (membership) | Permission keys (UI) | Backend key | Can |
| --- | --- | --- | --- |
| | `trucks:view` | `truck.read` | |

## 3. Screens and routes
For each screen:
### <Screen name> — `/<route>` (route group: (app) / (auth) / (public))
- Gate: `<permission keys>`; nav entry: yes/no (section)
- Shows: fields and columns, with their source field in the contract
- States: loading / empty (copy + next action) / error / success
- Actions: button → endpoint (below) → result (toast / navigate / inline)
- Mobile (360 px): what collapses or changes

## 4. API mapping
| UI action | Method + path | Permission | Idempotent | Request → Response | Errors to handle |
| --- | --- | --- | --- | --- | --- |

## 5. Validation (mirror the contract)
| Field | Rule | Message |
| --- | --- | --- |

## 6. Acceptance criteria
- [ ] AC1 … (tier: unit | browser)

## 7. Backend gaps / asks
What the UI needs that the contract doesn't provide yet. Each one says: blocking? workaround?

## 8. Out of scope

## 9. Open questions
- Q1 … → answer:
