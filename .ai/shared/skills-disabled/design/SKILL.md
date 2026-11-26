---
name: design
description: Visual and interaction design for web UI. Use this whenever the work involves how something looks or feels, even if the user never says "design": building or revamping a page, section, component, dashboard, form, chart or design system; choosing fonts, sizes, spacing, radii, colours, icons, motion or page structure; writing interface copy; finding and shortlisting design references, galleries, screenshots or live sites, or asking which direction to take; or reviewing UI that looks unfinished, generic, templated or off brand.
license: MIT. Complete terms in LICENSE.
compatibility: The loop needs network access and a browser you can drive. The scale runs offline.
---

# Design

One loop: **ask the genre → return at least ten references → the user picks → extract that site's system → turn the extraction into queries and sweep again → three previews → the user judges → build.**

The loop exists because a page built straight from a prompt is the average of the web. Nineteen previews that passed every accessibility and token check were still rejected nineteen times, because passing the checks is not the same as having an idea. The genre, the shortlist, the extraction and the three previews are how an idea gets in.

[The design scale](#the-design-scale) is the floor the loop's output must clear. It is not the work.

## Working files

| File | Read it | Holds |
|---|---|---|
| [references/DESIGN-REFERENCES.md](references/DESIGN-REFERENCES.md) | step 1, before the first search | the browser and video gates, the two corpora, the shortlist and extraction rules, the ledger, the evidence bar |
| [scripts/audit-design.py](scripts/audit-design.py) | step 4 and step 5 | token tables, motion rules, placeholder markers |
| [references/SURFACES.md](references/SURFACES.md) | step 2, when naming the layout the reference uses | surface families, layout paradigms, density, reflow |
| [references/COLOUR-AND-TYPE.md](references/COLOUR-AND-TYPE.md) | step 2, when extracting and rebuilding a palette or a scale | deriving state colours, tinted greys, dark grounds, units |
| [references/COMPOSITION.md](references/COMPOSITION.md) | step 4, before composing a preview | hierarchy, emphasis, grouping, surface separation, elevation, radius |
| [references/COMPONENTS.md](references/COMPONENTS.md) | step 5, and before calling any component done | family DNA, six states, forms, data, tabs, overlays, scroll, repeated entities |
| [references/ACCESSIBILITY.md](references/ACCESSIBILITY.md) | step 4 and step 5 | the WCAG 2.2 AA checks, ARIA patterns, semantics |
| [references/PERFORMANCE.md](references/PERFORMANCE.md) | step 4, before choosing fonts, images or a canvas | LCP, CLS and INP, font and image budgets, waiting states |

Every reference above ends with a done condition. That line is the action to take when you finish reading it.

## The loop

Five steps, three of which end in a question to the user. Ask one question at a time, phrased so the answer is a number or a word.

```
0 genre  →  1 ten references  →  [user picks]  →  2 extraction
         →  3 queries + sweep  →  4 three previews  →  [user judges]  →  5 build
```

### 0 · Ask for the genre

One question, one line: **what kind of site is this?** A genre, a world, a mood — "museum catalogue", "1970s Swiss poster", "kinetic type", "photocopied zine", "clinical instrument panel". Everything after this is derived from it.

- **Already in the request? Do not ask.** Restate it in one line and continue.
- In the same message, state the product in three lines of **assumption**: what it is, who it is for, the one action the page must make possible. Assumptions invite correction; questions invite silence.
- If the user hands you a link and says "like this", it is a genre. Say what the look is made of in one line before searching — not what the site is about.

Done when the genre is on the record and the three product lines are written.

### 1 · Shortlist at least ten, and ask which

Run the [browser gate](references/DESIGN-REFERENCES.md#browser-gate) before the first candidate: drive a browser you have, or ask for permission to drive the user's in an isolated session.

Sweep both corpora — the library through the [design MCP](references/DESIGN-REFERENCES.md#the-library-through-the-design-mcp), and the [directories](references/DESIGN-REFERENCES.md#reference-directories-not-references) — and return **at least ten** candidates.

- **Ten is the minimum, not the maximum, and not a target to pad to.** Twelve or fifteen are welcome when they are genuinely different; ten near-identical pages are worse than eight that differ. Never stop at ten while a distinct candidate is still in reach, and never invent one to reach the count.
- **Different from each other.** If two would look the same in a screenshot, one of them is not a candidate: replace it with something else, or drop it. Ten variants of one idea is one candidate, and a shortlist of those is a shortlist of one.
- **A still each**, at 1440 wide, comparable side by side. A candidate is shown, not described.
- **One line each, same shape:** `name · URL · what the page does · which part of it answers the genre`.

Then ask, numbers visible: **which of these matches what you have in mind?** One, a few, or none of them.

Done when ten or more *distinct* candidates with stills have been shown — the number is a floor, so more is better only while each one is different — and the user has answered.

### 2 · Extract the chosen system

A pick is a system, not a picture. Read it and write it down before building anything.

| Row | What goes in it |
|---|---|
| Type | faces and their roles, the scale in px, case, tracking, weight range |
| Colour | ground, ink, accent, how many colours in total, where the contrast lives |
| Motion | what moves, on what trigger, its easing and duration, what the entrance does |
| Layout | the grid, the container, how sections separate, what repeats |
| Assets | photography, 3D, illustration, texture, type as image, or none |
| Interaction | what the visitor does, and what it gives back |
| Voice | the copy's register, one sentence |

- Every row carries a **measured** value, never an adjective. "Serif display at `clamp(96px, 14vw, 220px)`, upright, tracking 0" is a value. "Elegant typography" is not.
- Measure it: computed styles and the stylesheet for a page, `video()` frames for motion, `code()` for durations and spacing.
- If the pick is only a mood, extract the properties you can state and mark which rows are inference.

Done when every row has a value and the table could be handed to another designer without explanation.

### 3 · Turn the extraction into queries, and sweep again

The inventory is a search query waiting to be written. Take its **distinctive** rows, never its generic ones, and derive three to six terms from them.

- Example: "hairline rules, no radius, dense columns, one red accent" → `swiss grid`, `editorial index`, `hairline table`, `letterpress`.
- Search the library with each term, open the directories with each term, and apply the same rule as step 1: what you keep must be different from what you have.
- Keep [the ledger](references/DESIGN-REFERENCES.md#the-ledger): accepted with the mechanic, rejected with the reason, blocked with the source.
- **A blocked source is routed around, never a stop.** Another directory, a search engine, an archive copy. Only the user can waive research.
- Stop at [the evidence bar](references/DESIGN-REFERENCES.md#evidence-bar) — three accepted artifacts for a page — not at a count of opens.

Done when the ledger holds at least three accepted artifacts from the chosen style's family, plus one deliberate contrast from outside it.

### 4 · Three previews, and ask which

**At least three**, each a different solution to the same genre — not three colours of one page.

- State each one before building it, in three lines: **the idea**, **the structure it forces**, and **what makes it not average**. If the third line would be true of any page, the direction is a **skin** — the same structure wearing different colours — and a skin is not a direction: replace it.
- Real files that open without a server: assets inlined or relatively referenced, a `file://` URL that works. A preview the user cannot click is not a preview.
- Each gets screenshots at 390 and 1440 and a clean audit **before** you show it, or you are asking for an opinion on something you would not ship.
- Composition from [references/COMPOSITION.md](references/COMPOSITION.md); budgets from [references/PERFORMANCE.md](references/PERFORMANCE.md).

Then ask: **which of these is good, and what is wrong with the others?** A rejection is data. Replace the rejected directions; do not re-skin the same skeleton.

Done when three previews exist, each with a stated idea and both widths, and the user has judged them.

### 5 · Build

The chosen preview is the direction. The scale below is the floor. The depth references are read where they apply, and the audit runs as you go.

```bash
python3 scripts/audit-design.py index.html styles.css
```

## From scratch

A from-scratch build runs the loop whole; it is the case the loop was written for. Nothing to extend, no reference from the user, and the genre question is the only way in.

Two rules on top: the shortlist *is* the reference, and the first artifact the user sees is a preview, never a description of one.

A tweak to an existing surface runs step 3 and step 5. Anything that changes structure runs the loop.

---

# The design scale

A **surface** is one page, screen or panel: the thing a visitor actually sees. Twelve checks, the floor under the loop. Work them in order: each one constrains the next, and the scale is done when `audit-design.py` reports no errors at both widths and the report names what stays unverified.

## 1. Purpose

- State the surface's one job, and the action it must make possible, before choosing anything.
- Every element earns its place by serving that job. Two competing jobs means two designs.

## 2. Structure

- Order the parts, and give the most important thing the best position, largest scale and most space.
- One primary action per surface. Equal-weight actions competing for attention is a structure bug.
- Each section answers a question the reader already has, in the order they ask it. Proof sits beside the claim it supports.
- Name the sections in order before writing markup. The surface family and the paradigm it implies are in [references/SURFACES.md](references/SURFACES.md).

## 3. Layout

- One grid, one container width. Sections do not invent their own.
- Reading measure: prose runs 60 to 75 characters, capped at 680px.
- Density is a decision: name it (airy or compact) and hold it.
- Reflow rather than shrink. Both widths, every time.
- Break lines where the thought breaks; no stranded last word (`text-wrap: balance` for headings, `pretty` for body).
- The page scrolls. Locking it with `body { overflow: hidden }` is a defect: see [scroll belongs to the page](references/COMPONENTS.md#scroll-belongs-to-the-page).

## 4. Typography

- There is no default face. The subject decides it, and you state the reason in one line. A stack naming Inter, Roboto, Arial, Open Sans or Helvetica fails the audit.
- One typeface per surface, plus a monospace only when the page really carries code, figures or tabular data.
- Set every face upright. Weight stops at bold; buttons are 16px semibold, smaller header buttons 14px semibold.
- Two faces pair only when their structures differ visibly.
- Numbers in tables, metrics and counters are tabular.

Every size resolves to a step. If an authored size does not, snap it to the closest step **below**, taking that step's line height with it.

| Class | Size | Line height |
|---|---|---|
| `text-xs` | 12px | 16px |
| `text-sm` | 14px | 20px |
| `text-base` | 16px | 24px |
| `text-lg` | 18px | 28px |
| `text-xl` | 20px | 28px |
| `text-2xl` | 24px | 32px |
| `text-3xl` | 30px | 36px |
| `text-4xl` | 36px | 40px |
| `text-5xl` | 48px | 1 |
| `text-6xl` | 60px | 1 |
| `text-7xl` | 72px | 1 |
| `text-8xl` | 96px | 1 |
| `text-9xl` | 128px | 1 |

Tracking and line height move only within what the matched step already provides, so the two rules never fight. Deriving the scale: [references/COLOUR-AND-TYPE.md](references/COLOUR-AND-TYPE.md).

Copy mechanics: no hyphens inside a sentence (rewrite the phrase), no orphaned words, sentence case for headings and buttons.

## 5. Spacing

These values and nothing between them.

| Token | Value | Token | Value |
|---|---|---|---|
| Spacing-0 | 0 | Spacing-500 | 40px |
| Spacing-25 | 2px | Spacing-600 | 48px |
| Spacing-50 | 4px | Spacing-700 | 64px |
| Spacing-75 | 8px | Spacing-800 | 80px |
| Spacing-100 | 12px | Spacing-900 | 96px |
| Spacing-200 | 16px | | |
| Spacing-300 | 24px | | |
| Spacing-400 | 32px | | |

Buttons: 8px vertical padding, 12px horizontal.

## 6. Surfaces

- Backgrounds stay flat. A gradient belongs on text, never behind it.
- A border runs all the way around a shape or does not appear.
- Radius comes from the Tailwind steps. When a shape sits inside another with less than 32px of gap: `inner radius = outer radius − gap`, applied only when the result is above 2.
- Depth shows containment and selection. Show structure with spacing rather than nesting cards.
- Separate a surface by exactly one means — border, elevation or fill — and hold it. Reasoning: [references/COMPOSITION.md](references/COMPOSITION.md).

## 7. Colour

- Name the roles and hold them: ground, surface, ink, muted, hairline, accent, plus one status set. One accent per surface.
- Body text reaches 4.5:1; large text and icons 3:1.
- Dark grounds: `#000000` · `#181818` · `#1F1F1F` · `#272727` · `#313131` · `#131209`.
- Colour carries meaning (series, status, selection, exception) and that meaning holds across the surface. Decoration stays in ink and ground.
- Derive, do not pick: hover and active from lightness steps, neutrals tinted with the brand hue. See [references/COLOUR-AND-TYPE.md](references/COLOUR-AND-TYPE.md).

## 8. Icons

- Default to Phosphor. Solar and Iconamoon are the alternates.
- One set, one stroke weight, sizes on the spacing scale. An icon that is an action's only label carries an accessible name.

## 9. Motion

- Base curve `cubic-bezier(0.22, 1, 0.36, 1)`. 500ms for layout and position; 200 to 300ms for colour and opacity. `ease`, `linear` and the other keywords fail the audit.
- Animate `transform` and `opacity`. Movement on `top`, `left`, `width` or `height` fails the audit.
- Entrance: rise 32px and fade over 600 to 800ms on the base curve, once per element, via `IntersectionObserver`.
- Motion clarifies change. It never delays access to content and never runs unattended as decoration.
- Under `prefers-reduced-motion: reduce`, drop travel, scaling and stagger; keep at most a brief opacity change. Content stays visible with motion off. Script-driven motion needs its own guard: [references/ACCESSIBILITY.md](references/ACCESSIBILITY.md#reduced-motion).

## 10. States

Every interactive element ships its full set: **hover** (surface shift or small transform), **active** (`scale(0.98)` or `translateY(1px)`), **focus** (a visible ring, not optional), **loading** (skeletons shaped like the real layout), **empty** (a composed starting view), **error** (inline and specific; `window.alert()` has no place in an interface).

No state shifts the surrounding layout. A control either goes somewhere or shows as disabled. The current location is visible. Per-component completeness, and the repeated-entity slot model: [references/COMPONENTS.md](references/COMPONENTS.md).

## 11. Content

- Write the copy, from the audience's side of the screen.
- People get full, specific names that fit the audience and region; each face belongs to one person.
- Numbers look found rather than rounded: prices with cents, metrics with a decimal, dates that vary.
- Filler stays out: revolutionize, supercharge, cutting edge, effortless, take it to the next level, harness the power, world class. Say what the thing does.
- Confirmations name the thing ("Invoice sent to Dana"). Errors say what failed and what to do next. Synthetic data is labelled synthetic.

## 12. Ship

- `<title>`, meta description, `og:image`, a branded favicon, alt text on every meaningful image.
- Semantic HTML: `<nav>`, `<main>`, `<article>`, `<aside>`, `<section>`. A skip link. Visible focus. Client-side validation for required fields and email format.
- Legal links where the product needs them, a custom 404, a way back from every page.
- The audit covers the mechanical tail: dead `href="#"`, images without alt, missing title, placeholder copy.
- Accessibility at WCAG 2.2 AA: [references/ACCESSIBILITY.md](references/ACCESSIBILITY.md).
- Performance budgets, and naming LCP, CLS and INP: [references/PERFORMANCE.md](references/PERFORMANCE.md).

---

## Report

- Open with the user's choice: the genre, the reference picked, the preview chosen.
- Name what works and how to try it, the audit's numbers, the screenshots' widths, and what stays unverified.
- Report accepted, rejected, blocked and unexamined candidates separately, plus the ledger's accepted list.
- Done when a reader can act on the message without opening the code.

## Credits

The six references that carry depth — surfaces, composition, components, colour and type, accessibility, performance — condense rules from [dembrandt-skills](https://github.com/dembrandt/dembrandt-skills), MIT licensed, pinned at `97b2031` and recorded in [SOURCES.md](SOURCES.md). They are rewrites in this skill's voice, not copies; the pinned revision is the audited source, not a claim that the text matches it.

The two-pass idea — state the direction, test it against what you would produce for any similar brief, then build — follows Anthropic's [frontend-design](https://github.com/anthropics/skills) skill. The distinction between surface and structural variation, and the ten-candidate floor, come from [Morphic's homepage study](https://www.getmorphic.com/resources/ai-creative-intelligence/why-ai-generated-websites-look-the-same/) and the productive-friction framing in ["Interrogating Design Homogenization in Web Vibe Coding"](https://arxiv.org/html/2603.13036).

Parts of this skill were adapted from [taste-skill](https://github.com/Leonxlnx/taste-skill) by Leon Lin ([@LexnLin](https://x.com/LexnLin)), MIT licensed. Its content realism checks and motion ideas informed the matching sections here, which have since been rewritten. Provenance and pins are recorded in [SOURCES.md](SOURCES.md).

<details>
<summary>taste-skill license</summary>

```
MIT License

Copyright (c) 2026 Leonxlnx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
</details>
