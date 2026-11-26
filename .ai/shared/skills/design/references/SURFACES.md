# Surfaces and layout paradigms

Read this at step 1 and step 3, before choosing a shape. It answers two questions a brief usually leaves open: **what kind of surface is this**, and **which layout paradigm carries it**.

## Name the surface family first

A surface is not generic. Its family decides its job, its unit of content and the shape that file naturally takes — and it decides what a visitor is doing there. Getting the family wrong is the most expensive mistake available, because every later decision inherits it.

| Family | Job | Unit | Default shape | Sabotage to watch for |
|---|---|---|---|---|
| Personal or portfolio | Say who a person is and what they can do, in one glance | The person, then their proof | One composition; the work is reached from it | Product-page furniture: card grids, counters, carousels, pricing blocks |
| Marketing or landing | Persuade a stranger who has not bought in | Sections in an argument | Narrative long-scroll, one idea per section, one CTA | Product screenshots pasted as content; a second competing CTA |
| Documentation | Answer one question fast | The answer | Dense text, sticky nav, code with copy affordance | Hero art, marketing rhythm, animation that delays the answer |
| Blog or editorial | Reward reading | The article | Narrow measure, dated metadata, real typography | App chrome around prose; link lists that leave the site |
| Product app | Let a trained person work for hours | The task, then the record | Shell plus one paradigm (see below) | Marketing whitespace, hero sections, oversized type |
| Dashboard or ops | Show state and what needs attention | The metric or the exception | Grid of small multiples, one alerting colour | A list pretending to be a dashboard; decoration competing with data |

**A marketing page and the product behind it are one brand at two densities.** Share the token layer; do not share the layout. A brochure that reads like an app exhausts the visitor; an app that reads like a brochure wastes the operator's screen.

## Inventory the surfaces the brief asked for

Before any layout: write the list of surfaces named or implied by the request, mark each *in* or *out* of scope in one line, and get that list agreed or at least stated. Then build every in-scope surface.

- Never add a surface nobody asked for, and never drop one silently.
- Never satisfy an in-scope surface by linking to an external site: rebuilding means rebuilding.
- A revamp means the surfaces exist here, not that they point at the old ones.
- If the request implies a surface you cannot build in the time available, say so at step 3, not at report time.

## Derive the paradigm from the content, not from taste

A layout paradigm is a consequence of what the content *is*, not a style you pick. Ask what relationship between items matters most, then read the answer off this table.

| The content is | Paradigm | Fits because | Do not use it when |
|---|---|---|---|
| A stream of recent items, read top down | Feed | Recency is the message | Items need comparison, or order is not temporal |
| Items moving through stages | Board | Columns make state visible | There are no discrete stages |
| Many records sharing fields | Table | Aligned columns compare values | Records are visual or very few |
| Visual, heterogeneous items | Gallery or grid | The artifact is the content | Precise values matter more than appearance |
| A list and the selected record | Master–detail | Context while drilling in | On mobile, where panes do not fit |
| Many metrics at a glance | Dashboard | Spatial triage | The user has one task, not monitoring |
| Spatial relationships | Canvas | Space is the data | Content is inherently linear |
| One decision, full attention | Single focus or wizard | Removes everything else | The user needs surrounding context |
| A stranger to persuade | Narrative long-scroll | Sequence is the argument | Inside the product, where they already committed |

Then hold it. One paradigm per surface, reused across screens. A product whose every screen invents its own layout is not varied, it is unlearnable.

## Density is a decision, and it follows the user

Name the density (airy or compact) and apply it in spacing tokens, not one-off padding. Consumer surfaces run airy; daily-use tools run compact. On mobile, collapse or reposition secondary content rather than shrinking it, and keep every target at least 44px.

## Reflow, do not shrink

Check 3 already asks for both widths. The part it does not settle is what changes between them — shrinking is not a reflow.

- Build mobile first, then add width.
- Navigation on mobile is a bottom bar or a drawer, not a squeezed top nav.
- Hover-only affordances get a tap equivalent.
- The primary action stays reachable with one thumb.
- Sticky and fixed behaviour adapts per breakpoint; nothing stays sticky on mobile because it was sticky on desktop.
- Cap the reading column on very wide screens instead of stretching it.

Done when the surface family, its paradigm, the in-scope list and the density are each written in one line, and the layout at 390px is a considered arrangement rather than a stack of what desktop had.
