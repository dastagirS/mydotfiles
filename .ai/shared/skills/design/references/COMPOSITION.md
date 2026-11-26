# Composition

Read this at step 3 and step 4, when deciding what the eye hits first and how the page holds together. The scale's checks 2, 3 and 6 give the rules; this file gives the reasoning and the failure modes.

## One primary thing per view

Every view has one most important thing. Hierarchy is the work of making the eye land there without the reader deciding for themselves. Emphasis comes from size, colour, weight, contrast and position — all of them relative, so an element reads as important only by differing from what surrounds it.

| Level | Treatment |
|---|---|
| Primary | Filled in the accent, the largest interactive element in its group, one per view |
| Secondary | Outlined or ghost, neutral, same or slightly smaller |
| Tertiary | Text link or quiet ghost, visually recessive |
| Disabled | Low contrast, no hover, signals "not yet" |

Two filled buttons side by side cancel each other. A 2px size difference reads as a mistake rather than as rank, so use steps you can see.

## Commit the accent to one role per view

Either the brand colour fills a large region (hero, banner) and controls on it are neutral, or the colour sits on interactive elements and backgrounds stay neutral. Doing both at once removes the signal from everything, because nothing is special any more. Status colours never double as the accent: they already mean something.

## A focal point is made of contrast and air

The strongest device is a high-contrast element with generous space around it. Space frames the thing; removing neighbours is as much hierarchy work as enlarging it.

## Group by proximity before you reach for a border

- Proximity is the first grouping signal. Related things sit close; unrelated things get real space.
- Similarity: things that look alike are assumed to behave alike, so they must. Two visually identical controls with different jobs is a bug.
- Common region: a card holds one subject under one heading, and no grid cell is left orphaned.
- Continuity: elements on one line are read as a series, so do not break a series with an unrelated control.
- The result of a click appears near the click, in the same place every time.
- Prefer removing a divider and adding space over adding a rule. Lines are a last resort, not a default.

## Separate a surface by exactly one means

A card, row, panel or toolbar needs to read as distinct. There are three ways — border, elevation, fill — and the error is using two at full strength. Pick one per surface family and hold it across the product.

- Opacity is for state (hover, disabled, dimmed), never for separation.
- Elevation is a small named scale as tokens, not a shadow invented per component.
- Cards carry a 1px border as well as a soft shadow on light grounds; heavy black shadows read as dated.
- On dark grounds, a border or an adjusted lighter fill separates better than a shadow.
- Radius is one family. Check 6 gives the inner-radius formula; what it leaves open is which gaps it applies to — concentric shapes only, not every nested pair.

Done when you can name the primary element of each section, the one separation means used, and the grouping that makes the structure readable without any borders at all.
