# Agent Reliability Plan

This plan improves response quality in small, testable steps. Each step should be implemented and validated independently.

## 1. Stable system instruction

Give the agent a fixed identity, safety policy, action rules, and output contract through the model's system instruction.

## 2. Separate dynamic user context

Send the user's request, page text, DOM snapshot, selection, and optional image as request-specific user content instead of mixing them into the permanent policy.

## 3. Enforce structured output

Use the SDK response configuration/schema to require the JSON shape instead of relying only on prompt wording.

## 4. Add request intent classification

Classify requests as informational, summarization, search, click, type, scroll, or navigation before selecting an action.

## 5. Validate proposed actions

Validate action type, selector presence, URL safety, text length, and `pressEnter` before returning an action to the extension.

## 6. Make action-null behavior explicit

Require `action: null` for informational and summarization requests, and reject unexpected actions in text-only mode.

## 7. Separate planning from execution

Use a planner response first, then a local validator/executor step. Keep browser execution outside model reasoning.

## 8. Improve fallback and observability

Use targeted screenshot fallback, retry only transient provider errors, record model/latency/fallback metadata, and expose concise user-facing errors.

## Implementation status

- [x] Step 1: Stable system instruction
- [x] Step 2: Dynamic page data in user message
- [x] Step 3: Structured output schema
- [x] Step 4: Request intent classification
- [x] Step 5: Action validation
- [x] Step 6: Explicit action-null enforcement (the planner requires an action only for `executing`; text-only mode still rejects actions)
- [x] Step 7: Planner/executor separation (one action per planner call, then fresh observation and replanning)
- [x] Step 8: Targeted screenshot fallback and bounded run state; structured action telemetry remains future work

## Planner/executor loop

`POST /api/agent/next` accepts one current goal and one bounded page observation. It returns a structured plan and at most one action. The extension checks the target locally, applies confirmation policy, executes that action, and asks again using a fresh observation. Runs stop after 10 actions or more than 2 retries. Active state is kept in `chrome.storage.session` and can be resumed from the popup or side panel.

The harmless local fixture is served at `/agent-fixture` and supports search, links, a button state change, and scrolling checks.
