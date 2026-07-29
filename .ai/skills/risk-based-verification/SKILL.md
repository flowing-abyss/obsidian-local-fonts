---
name: risk-based-verification
description: >
  Designs and executes a risk-based verification matrix for behavior-changing
  work. Use after design approval, before implementation, and before claiming
  completion. Complements Superpowers TDD and verification skills; does not
  replace them.
---

# Risk-Based Verification

## Purpose

Testing effort must follow risk, not file count or code coverage.

Apply this skill to every change that modifies observable behavior, crosses a
boundary, changes stored data, affects authorization, introduces concurrency,
or changes a public contract.

## Ownership

Superpowers owns:

- implementation planning;
- red-green-refactor;
- systematic debugging;
- completion verification.

This skill owns:

- risk identification;
- test-strategy selection;
- verification coverage;
- evidence reporting.

## Step 1: Define the change contract

Before implementation, record:

- intended behavior;
- preserved behavior;
- invariants;
- explicit non-goals;
- compatibility requirements;
- acceptable failure behavior.

Do not proceed when the intended behavior cannot be stated observably.

## Step 2: Build the risk map

Evaluate each category:

| Risk | Questions |
|---|---|
| Data integrity | Can data be lost, duplicated, reordered, or corrupted? |
| Security | Can authorization, validation, or secret handling regress? |
| Boundaries | Can external APIs, queues, databases, or files behave differently? |
| Concurrency | Can retries, races, duplicate delivery, or partial failure occur? |
| Compatibility | Can existing clients, schemas, configs, or persisted data break? |
| Availability | Can the change create timeouts, overload, deadlocks, or retry storms? |
| User behavior | Can a user-visible workflow fail despite unit tests passing? |

Classify each applicable risk as low, medium, or high.

## Step 3: Create the verification matrix

Select tests based on identified risks:

- unit tests for local logic;
- regression tests for every fixed defect;
- boundary and negative tests for invalid or hostile inputs;
- contract tests for module and service interfaces;
- integration tests for databases, queues, files, and external adapters;
- property or invariant tests where many input combinations are possible;
- concurrency and idempotency tests where retries or parallelism exist;
- end-to-end tests for critical user workflows;
- performance comparison when latency, memory, or throughput may change;
- migration and rollback tests for stored-data changes.

Every medium or high risk must map to at least one executable verification.

## Step 4: Establish the baseline

Before modifying behavior:

1. Run the smallest relevant existing test suite.
2. Record existing failures separately.
3. For a bug fix, create a test that fails for the reported defect.
4. Do not attribute pre-existing failures to the new change.

## Step 5: Execute progressively

Run verification in this order:

1. new or modified tests;
2. affected module or package tests;
3. integration or contract tests;
4. lint and static analysis;
5. type checking;
6. build;
7. full test suite when practical;
8. runtime or browser verification when applicable.

Stop on the first unexplained failure.

## Step 6: Report evidence

Completion reports must include:

- exact commands executed;
- exit codes;
- number of passed, failed, skipped, and flaky tests;
- risks covered by each test;
- verification that was not performed;
- residual risks.

Do not write "all tests pass" unless the tests were executed in the current
working tree.

## Stop Conditions

The work is not complete when:

- a high-risk item has no executable verification;
- a bug fix has no regression test;
- skipped tests are relevant to the change;
- a flaky test was ignored rather than investigated;
- migration rollback was not tested;
- only mocked behavior was tested for an external boundary;
- verification output is unavailable or ambiguous.
