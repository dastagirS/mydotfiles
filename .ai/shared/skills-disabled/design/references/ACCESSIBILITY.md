# Accessibility

Read this at step 4 and step 5. Accessibility is not a final pass; it is a set of decisions that are cheap while building and expensive afterwards. WCAG 2.2 AA is the bar.

## The checks that fail most often

Checks 7 and 10 own the contrast bar and the focus ring; their values appear below only because an accessibility pass is read as one list, and stopping to cross-reference three files is how a pass gets skipped.

| Area | Bar |
|---|---|
| Contrast | Body text 4.5:1; large text and UI edges 3:1; disabled controls exempt (check 7) |
| Colour | Colour is never the only carrier of meaning |
| Keyboard | Everything interactive is reachable and operable without a mouse |
| Focus | A visible ring on every interactive element; `outline: none` without a replacement fails (check 10) |
| Targets | 24×24 CSS px minimum, 44×44 on touch surfaces |
| Labels | Every input has a visible label, not just a placeholder |
| Errors | Each error names the field, says what is wrong, and how to fix it |
| Semantics | Real elements first; ARIA only where the platform has no element |
| Language | `lang` on `<html>` |
| Skip link | "Skip to main content" is the first focusable element |
| Live regions | Dynamic updates announced with `role="status"` or `role="alert"` |
| Zoom | Usable at 200% text zoom and 320px width without loss |

## Keyboard and focus

Order follows the visual order. A focus trap exists inside modals and drawers, and closes with Escape. Nothing traps focus on a page that is not an overlay. Custom rings keep a transparent outline so forced-colours mode still shows a pointer.

## ARIA patterns worth naming

- **Tabs**: `role="tablist"` with `role="tab"`, roving tabindex, `aria-selected`, panels labelled by their tab.
- **Dialog**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus moved in and returned on close.
- **Disclosure or accordion**: a `button` with `aria-expanded` and `aria-controls`; the panel is a plain region.
- **Live updates**: `role="status"` for confirmations, `role="alert"` for errors, both present in the DOM before they change.

Do not add a role to compensate for a missing element. A `div` with `role="button"` also needs focus, keys and a disabled story, and a real `button` has all three.

## Semantics and findability

One `h1`, headings in order, landmarks (`nav`, `main`, `article`, `aside`, `section`) around real regions. Alt text states the content of a meaningful image and is empty for decoration. Link text says where it goes; "read more" without context fails. The title, meta description, `og:image` and a branded favicon are part of shipping, and the audit covers the mechanical tail: dead `href="#"`, unlabeled images, placeholder copy.

## Reduced motion

Check 9 owns the CSS half. What it cannot cover is script-driven motion: a media query does nothing for a canvas, a WebGL field or a `requestAnimationFrame` loop, so each of those needs its own guard, and it must render a still or a reduced variant when the preference is set. Content stays visible with motion off either way.

Done when keyboard alone can complete the surface's one job, and the audit plus one manual tab-through agree.
