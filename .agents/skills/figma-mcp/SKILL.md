---
name: figma-mcp
description: Use the Figma MCP server to translate a Figma design into a Vue page or component layout. Use when the user provides a Figma URL, asks to implement a design, or wants to draft a page layout from Figma.
argument-hint: <figma-url>
---

Refer to the standard: @standards/frontend/FIGMA_MCP_USAGE.md
Also read @packages/ui/AGENTS.md for color token mapping and component conventions.

## Steps

1. **Parse the Figma URL** from `$ARGUMENTS` — extract the `fileKey` and `nodeId`. Convert `-` to `:` in the node ID.
2. **Read the standards above** for the available tools, adaptation rules, and color usage.
3. **Call `get_design_context`** with the extracted `nodeId` and `fileKey`, using `clientLanguages: "typescript,html,css"` and `clientFrameworks: "vue"`. This is always the first tool to call.
4. **Adapt the output to the Starlight codebase:**
   - Map Figma color variables to `surface-*` / `text-*` Tailwind tokens — never use Figma's aliased names directly. The Tailwind preset lives at `packages/tooling-config/tailwind/tailwind-preset.ts`.
   - Check `packages/ui/src/components/` for existing components that match elements in the design (buttons, cards, modals, inputs, etc.).
   - Check `packages/assets/styles/variables.scss` for tokens not exposed in Figma.
   - Match spacing values exactly from the design.
   - Use TAB indentation everywhere, never spaces (CLAUDE.md rule).
   - Express UI styling with Tailwind utility classes directly on elements. Never add a custom CSS class that only aliases one or a few declarations a utility can express verbatim.
5. **Use `get_screenshot`** if you need a closer visual reference of specific nodes.
6. **Use `get_variable_defs`** to verify which design tokens are applied to ambiguous elements.
7. **Build the component** as a Vue SFC using Tailwind classes and the project's existing component library (`@modrinth/ui`).
8. **Internationalize** any user-visible strings using `defineMessages`/`defineMessage` and `useVIntl()` / `<IntlFormatted>` from `@modrinth/ui` (see @standards/frontend/INTERNATIONALIZATION.md).
9. **Verify** no hard-coded English strings remain in templates.
