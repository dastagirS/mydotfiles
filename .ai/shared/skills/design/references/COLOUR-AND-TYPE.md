# Colour and type, derived rather than picked

Read this when choosing or extending a palette or a type scale. The scale's checks 4, 5 and 7 give the rules; this file gives the derivations that make a system hold together.

## One palette, derived

Check 7 names the roles. What it leaves open is how each one is derived, and that is where a palette either holds together or turns into a collection of colours.

- Hover and active are lightness steps from the base, not independent colours.
- Neutrals are tinted with the brand hue, and their saturation drops as they lighten. Generic `#666` and `#eee` read as someone else's greys.
- Avoid pure black on pure white: near-black ink on an off-white ground.
- Every colour has a role. A colour without a role is decoration, and decoration stays in ink and ground.
- Focus gets its own token, and it passes contrast.

## Status is a closed set

Four semantic colours at most, plus neutral. Each means exactly one thing and is used identically everywhere. Amber is for warnings only; if the accent is orange, warning needs a different treatment to stay distinguishable. Terminal states look different from open ones. Green is for a good outcome, not for "in progress".

## Dark grounds

A dark theme is not an inversion: surfaces separate by lightness, elevation reads through a border or a lighter fill rather than a shadow, and light text needs a slightly heavier cut because light glyphs on a dark ground bleed outward (halation) and read thinner than the same weight inverted. Offer a theme only when there is a reason; when there is, both modes come from the same tokens.

## Type scale

- Base 16px or larger; nothing below 14px anywhere, and 14px never carries body copy.
- Fewer than a handful of sub-16 roles per screen, all secondary — never reading content.
- Four or more distinguishable steps between body and the largest heading.
- Body tracking is zero. Uppercase labels cap at `0.04em` and only when the air is needed; balance their gap by the glyphs, not the line box, so an all-caps label does not gain phantom space above its first row.
- Monospace is for code, figures and tabular data, never as the default face and never uppercased.
- Name size tokens by role or step, not by pixel value, so a change of base does not rename everything.
- `rem` for text and containers that hold it, so a user's larger default font still works; a fixed pixel height on a text container is a trap.

Done when you can state each colour's role and derivation in one line, and every size on the page lands on a step of one scale.
