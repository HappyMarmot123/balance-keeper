---
name: planning-agent
description: Plan and govern substantial repository work through docs/PROJECT-JOURNAL.md. Use when proposing or decomposing a Task, choosing or changing execution mode, changing Task scope, status, or dependencies, recording approval, handling BLOCKED work, coordinating subagents, or updating the project journal.
---

# Planning Agent

## Use the canonical journal

Treat docs/PROJECT-JOURNAL.md as the single source of truth for product decisions, Task scope, status, evidence, and regression results. Link any supporting artifact from the journal instead of creating a competing plan.

Before acting, read the current Task card and confirm:

- The Task is APPROVED.
- Every dependency is ACCEPTED.
- The requested change fits the included scope and does not enter the excluded scope.

Do not treat PROPOSED as authorization. Only the user can grant APPROVED or ACCEPTED. Record an imperative request as approval only when its Task and scope are unambiguous; otherwise ask before acting. Request renewed approval when scope, dependencies, or a material decision changes.

## Follow the selected execution mode

Ask for the execution mode before the first Task when the journal does not already record it.

- **Auto mode:** Continue through approved Tasks while every guardrail passes.
- **Approval mode:** Work on one approved Task only. Report its result, then wait for the user to mark it ACCEPTED before starting a dependent or subsequent Task.

When a new request arrives during an active Task, determine whether it amends, replaces, or queues after that Task. A Task at PASS but not ACCEPTED is still active. Do not switch until the user's intent is clear and the journal records the decision. A future request does not by itself block the active Task.

Use this status flow:

    PROPOSED → APPROVED → IN_PROGRESS → VERIFYING → PASS → ACCEPTED
                                      └────────────→ BLOCKED

PASS records verified work. It is not user acceptance. Only the user can grant ACCEPTED.

Leave an unapproved Task PROPOSED or NOT_STARTED. A user-approved Task with unmet dependencies may remain APPROVED and queued, but it cannot enter IN_PROGRESS. Use BLOCKED when active approved work cannot safely continue, not merely because a future dependency is incomplete.

When the user amends a Task after PASS but before ACCEPTED, label the old PASS evidence superseded, revise the Task card, obtain approval for the new scope, and return it to APPROVED before work resumes. For a full replacement, ask the user to resolve the active Task rather than inventing a cancellation status.

## Record an executable Task

For each Task, record:

- Purpose and reason
- Included and excluded scope
- Decisions and dependencies
- Files or systems that may change
- Completion conditions
- Normal, failure, boundary, and regression checks
- Evidence and approval state

Keep the workflow explicit:

    idea → screening → planning → codebase analysis → document review
         → Task split → RED → GREEN → REFACTOR → verify → review → regression

Skip codebase analysis only for genuinely new work with no existing behavior to inspect.

## Enforce the guardrails

At each stage, confirm:

- Scope is explicit.
- Decisions have code, test, official-documentation, or reproduction evidence.
- The change does not contradict existing behavior without an approved replacement.
- The journal remains understandable.
- Regression impact and verification are known.

Use the project TDD skills after approval. Observe a meaningful failing test before implementation, make the minimum change, refactor while green, then run the Task-specific checks and npm run validate.

Use subagents only for bounded research inside the active Task. In approval mode, do not let them begin a later Task. The main agent must verify their conclusions and serialize journal edits.

## Close or stop

Mark a Task PASS only when all required checks pass and no known regression or unverified critical path remains. Record commands and concrete evidence in the journal, then wait for acceptance.

Mark the Task BLOCKED, record the exact cause and release condition, ask the user, and stop when information is missing, requirements conflict, validation fails, or regression risk remains unresolved. Never fill a blocker with assumptions.

APPROVED authorizes scoped edits and verification, not a final commit. In approval mode, wait after PASS for the user to grant ACCEPTED before the final commit. A checkpoint commit is allowed only while a Task is IN_PROGRESS, when the user explicitly identifies that active Task and asks to preserve an intermediate state; record that authorization before committing. Generic wording such as commit when done is a final-commit request and does not bypass acceptance. Push or deploy only when the user explicitly requests it. Record a resulting commit hash in the next journal entry; a commit does not need to contain its own hash.
