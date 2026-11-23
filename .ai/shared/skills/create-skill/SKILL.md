---
name: create-skill
description: Creates new skills, modifies and improves existing skills, and validates skill behavior. Use when the user wants to create a skill from scratch, edit or optimize an existing skill, run test prompts to check a skill, or improve a skill description for better triggering accuracy.
---

# Create skill

A skill for creating new skills and iteratively improving them.

## Read the rules first

Read [references/AUTHORING-RULES.md](references/AUTHORING-RULES.md) before writing or editing a skill. Those rules are copied from Anthropic's skill-creator and are not paraphrased. The only changes are Claude-specific wording replaced with the agent, Pi, or OpenCode, plus subagent availability gated on user approval.

Do not rewrite those rules in your own words. If an environment detail forces a change, make the smallest substitution and record it in [SOURCES.md](SOURCES.md). If upstream changes, update the reference from the pinned source and record the new pin.

## Workflow

### 1. Capture intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture. Extract answers from the conversation first: tools used, sequence of steps, corrections, and input/output formats observed.

Ask one unresolved question at a time, then wait for the answer. Do not write the skill until the intent, trigger contexts, output, and dependencies are clear.

Use the exact Capture Intent questions in [AUTHORING-RULES.md](references/AUTHORING-RULES.md#capture-intent).

### 2. Choose the file layout

Use the anatomy from [AUTHORING-RULES.md](references/AUTHORING-RULES.md#anatomy-of-a-skill):

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Only add directories the skill actually needs. Keep `SKILL.md` under 500 lines; move detail into one-hop reference files. Give reference files over 300 lines a table of contents. Use uppercase reference filenames for entry references.

### 3. Write the description

Read the exact description rule in [AUTHORING-RULES.md](references/AUTHORING-RULES.md#write-the-skillmd) before writing frontmatter. It is the primary triggering mechanism. Apply it as written; do not paraphrase it.

Structural limits:

- `name` matches the directory and is kebab-case, at most 64 characters.
- `description` is at most 1024 characters and contains no angle brackets.
- Frontmatter uses `name` and `description`; optional keys are `license`, `allowed-tools`, `metadata`, and `compatibility`.

### 4. Write the instructions

Use the writing patterns and writing style in [AUTHORING-RULES.md](references/AUTHORING-RULES.md#writing-patterns) and [AUTHORING-RULES.md](references/AUTHORING-RULES.md#writing-style).

Also apply these consistency rules:

- Define ambiguous terms before using them.
- Give every checklist a clear done condition.
- State what not to do when misuse is likely.
- Keep one authoritative version of each rule. Link to it rather than duplicating or paraphrasing it.
- Do not include a reference without saying when to read it and what to do next.
- Do not leave invented paths, commands, assets, or examples.
- Do not add time-sensitive facts.
- If the skill copies third-party content, include `LICENSE` and `SOURCES.md` with the upstream URL, pin, retrieval date, and local changes.

### 5. Validate structure and links

Run the relevant checks before reporting the skill complete:

```bash
python3 ~/.ai/build.py --links --check
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ~/.ai -p 'test_*.py'
git diff --check
```

Check by inspection as well:

- Every relative Markdown link resolves.
- Every named asset exists.
- `SKILL.md` is under 500 lines.
- Reference files are one hop from `SKILL.md`.
- No stale references remain to renamed or deleted files.
- Frontmatter matches the directory and the description rule.

If a test failure is unrelated to the skill, report it separately. Do not hide it, delete the test, or weaken an assertion to make the run pass.

### 6. Run test prompts

Use the Test Cases rule in [AUTHORING-RULES.md](references/AUTHORING-RULES.md#test-cases) when the output is objectively checkable. For subjective skills, use qualitative review instead.

Harness adaptations:

- Use 2–3 realistic prompts, not abstract requests.
- Run with the skill and, where practical, without it or against the previous version.
- Use disposable agent and session directories. Never test against a real session.
- Do not use a browser viewer, benchmark aggregator, or `.skill` packager; our harness does not provide them.
- Use subagents only when the user has approved delegation and the task is suitable.
- Preserve evidence outside directories removed by cleanup. Remove task-owned temporary files and processes afterward.

Read the transcripts, not just final outputs. Improve the skill from what the agent actually did.

### 7. Place and link the skill

Put the skill in `~/.ai/shared/skills/<name>/`. Do not use `pi install`, `npx skills add`, or a client-local copy.

Run:

```bash
python3 ~/.ai/build.py --links
python3 ~/.ai/build.py --links --check
```

Confirm both client links exist:

```text
~/.pi/agent/skills/<name>
~/.config/opencode/skills/<name>
```

A running client needs `/reload` or a new session before it sees the skill.

## Done when

- The exact authoring rules were read and applied without paraphrase.
- The description names both what the skill does and when to use it.
- `SKILL.md` and every reference link resolve.
- The skill has been checked with the available validation commands.
- Test prompts were run, or the reason they were not practical is stated.
- Both clients link to the shared original.
- Temporary artifacts are removed and remaining limits are reported.
