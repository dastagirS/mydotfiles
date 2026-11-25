# Components and behaviour

Read this before calling a component done, and again before reporting. The scale's check 10 gives the state list; this file is the completeness bar, component by component.

## One family, one DNA

Controls that sit together share a height, radius, horizontal padding and colour logic. Set the height explicitly rather than letting padding, line height and border add up to it, and give that height to the whole family from one class so a new hover state cannot land on one sibling only.

- Measure the real stylesheet at more than one viewport instead of reasoning about heights.
- Focus looks identical on every focusable control; so does error.
- Bordered components use at most two widths.
- Buttons, inputs, pills and selects share the radius token, not a similar value.

## Six states, derived not invented

Check 10 lists the six. What it leaves open is where the other five values come from, and the answer is derivation rather than five hand-picked colours.

- Hover and active come from the base colour by a lightness step.
- Focus is visible on every interactive element and is never `outline: none`. Keep a transparent outline for forced-colours mode.
- Disabled reads as unavailable: reduced contrast, no hover, `cursor: not-allowed`.
- Loading disables re-submission and shows progress on the control itself, not via the cursor.
- `cursor: pointer` at rest on everything interactive.
- Transitions run 80 to 150ms for state changes; longer feels laggy, instant feels broken.

## Forms

- Every field has a visible label. A placeholder is a format example, never the label.
- Helper text sits below the input and says what to enter.
- Validate on blur for simple fields; error text sits beside the field it belongs to and is wired with `aria-describedby`.
- Mark the minority: if most fields are required, mark the optional ones.
- Group related fields in `fieldset` with a `legend`; use the right `input type` and `autocomplete` values.
- Textareas grow between a minimum and maximum height instead of scrolling a two-line box.
- The submit control shows loading and cannot be pressed twice.

## Data and selection

- The whole row or card is the hit area, not the checkbox alone.
- Selected state is a subtle background shift, matching the selection colour used everywhere.
- Selection brings a mass-action bar — one toolbar acting on everything selected — that counts the selection; a destructive one confirms and names the count.
- Active filters appear as removable chips; an empty result differs from a genuinely empty collection.
- One legend per page at most, never inside a chart that already labels its values; numbers are comprehensible at a glance.

## Tabs

Two to seven, never nested, never wrapping. Roving tabindex — one tab in the strip is tabbable and the arrow keys move that slot between tabs, so Tab lands in the panel instead of walking every tab. Use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, and hide inactive panels from the accessibility tree. Persistent view state belongs in the URL.

## Overlays

Choose the smallest thing that does the job, in this order: tooltip, popover, menu, bottom sheet, drawer, modal. It is one family with one shell.

- Focus moves into the overlay on open and returns to the trigger on close; focus stays trapped inside while open.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on modals and drawers.
- Escape closes — except when closing would discard work; click-outside follows the same rule.
- Long content scrolls in the body with header and footer fixed.
- Destructive confirmation names the item and the consequence, and its button is labelled with the verb, never "OK".
- On mobile a modal becomes a bottom sheet.

## Notifications and recovery

Every error needs a recovery action: retry, undo, or a named next step. Success toasts dismiss themselves; error toasts stay until dealt with; one toast at a time. Field errors sit beside the field; section banners at the top of that section. Announce errors with `role="alert"` and status changes with `role="status"`.

## Scroll belongs to the page

The default is a single page scroll. An inner scroll area costs the user discovery and a second scroll position, so restructure before adding one.

- Inner scroll is justified only for a fixed navigation tree, a table whose header must stay, a chat or log stream, and an editor pane.
- One axis only: `overflow-y: auto` with `overflow-x: hidden`, never `overflow: auto`.
- Never hijack, pace or auto-scroll the page. Chat may follow new content only while the user is already at the bottom.
- Never lock the page to one screen with `body { overflow: hidden }`. A page that must scroll and cannot is the bug this file exists to prevent.

## Repeated entities are one slot model

Cards, rows and list items that repeat fill the same slots in the same order, so they align down the page.

- Equal sizes come from a stretched grid or flex track, not a fixed height.
- The anchor (CTA, price, status, value) is pinned — `margin-top: auto` in a column, `margin-left: auto` in a row — so it lines up across instances.
- Exactly one slot absorbs length variance; the rest are fixed or clamped.
- Media uses a fixed aspect ratio and is protected from stretch.
- Long text clamps to a line count, short values ellipsize, `min-width: 0` lets flex children shrink, and the full value stays recoverable.

## Fixed and sticky

`sticky` is section-scoped; `fixed` is for truly global UI. A fixed header compensates its own height with body padding, bottom bars respect the safe-area inset, and every z-index is a named token. Keep the number of simultaneous fixed layers to a minimum.

Done when every interactive element has its full state set, every component above has its own list satisfied, and the page scrolls with the wheel from anywhere on it.
