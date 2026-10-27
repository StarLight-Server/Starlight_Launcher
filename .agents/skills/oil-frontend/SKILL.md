---
name: oil-frontend
description: 用于实现、修改、重构或评审产品前端。当前任务涉及页面、组件、交互、表单、状态、数据流、Hook、类型、CSS、前端代码组织或共享实现时自动触发。触发后先阅读 SKILL.md 判断相关范围，只读取与当前任务直接相关的参考文件；如果改动与产品前端无关则停止使用。纯构建、部署、依赖升级、安全、后端任务，以及只解释前端概念而不处理项目实现的请求，不触发。
---

# Starlight Launcher Frontend Rules

Starlight Launcher is a Turborepo monorepo with Vue 3 / Nuxt 3 + Tailwind CSS v3 for frontend and Rust / Tauri for desktop.

## Always Follow

- Use TAB indentation everywhere, never spaces (CLAUDE.md rule).
- Express UI styling with Tailwind utility classes directly on elements. Never add a custom CSS class that only aliases one or a few declarations a utility can express verbatim.
- Use shared tokens only: Tailwind preset at `packages/tooling-config/tailwind/tailwind-preset.ts`, theme variables in `packages/assets/styles/variables.scss`. Standard mappings: `gap-1/2/3/4/6`, `text-secondary`, `text-contrast`, `bg-surface-N` / `border-surface-N`, `bg-button-bg`, `border-divider`, `rounded-[var(--radius-*)]`.
- Never reference CSS variables not defined in the shared theme.
- All user-visible strings must use the i18n system (`defineMessages`/`defineMessage`, `useVIntl()`, `<IntlFormatted>` from `@modrinth/ui`). No hard-coded English strings in templates or scripts.
- Custom classes only where utilities cannot express: `:deep`/child/pseudo selectors, animated states, `::before`/`::after` with `content`, platform-conditional rules, third-party rendered content, or `@apply`-composed variants.
- Multi-statement Vue template handlers must use semicolons on a single line: `@click="foo = true; $emit('bar')"`.
- Delete temporary test files after verification. Don't leave them in the worktree.

## Project Structure

| Path | Purpose |
|------|---------|
| `packages/ui/src/components/` | Shared Vue components (barrel exports from root `index.ts`) |
| `packages/ui/src/composables/` | Vue 3 composition API hooks |
| `packages/ui/src/providers/` | DI contexts (`createContext` pattern) |
| `packages/ui/src/layouts/` | Cross-platform page layouts (`shared/`, `wrapped/`) |
| `packages/ui/src/locales/` | 34 language locale files (FormatJS/Crowdin JSON) |
| `apps/app-frontend/src/` | Desktop app frontend (Vue 3 + Vite + Tauri) |
| `apps/website/src/` | Official website (Nuxt 3 static site) |

## Key Patterns

### API Client (platform-agnostic)
Always use `injectModrinthClient()` + `this.client.request()` from `@modrinth/api-client`. Never `$fetch`/`fetch` directly in Tauri.

### DI (`createContext`)
Providers defined in `packages/ui/src/providers/` using `createContext` from `@modrinth/ui`. Existing: `provideModrinthClient`, `provideNotificationManager`, `providePageContext`, `provideServerContext`.

### i18n
```ts
const messages = defineMessages({
    welcomeTitle: { id: 'auth.welcome.title', defaultMessage: 'Welcome' },
})
const { formatMessage } = useVIntl()
```
```vue
<button>{{ formatMessage(messages.welcomeTitle) }}</button>
<IntlFormatted :message-id="messages.tosLabel">
    <template #terms-link="{ children }">
        <NuxtLink to="/terms"><component :is="() => children" /></NuxtLink>
    </template>
</IntlFormatted>
```

## Reference Standards

- `@standards/frontend/SURFACE_SYSTEM.md` — UI elevation/separator tokens
- `@standards/frontend/MODALS.md` — regular and multistage modal APIs
- `@standards/frontend/ADDING_API_MODULES.md` — adding API modules to api-client
- `@standards/frontend/DEPENDENCY_INJECTION.md` — provide/inject DI layer
- `@standards/frontend/INTERNATIONALIZATION.md` — translatable strings, ICU format, i18n conventions
- `@standards/frontend/FIGMA_MCP_USAGE.md` — Figma designs to Vue components

## Decision Order

Before making changes, answer:
1. What task is the user completing? What result means done?
2. What core object does the page manage, and who owns each field?
3. Is this browse, compare, select, or edit? Does it use familiar structure/terms?
4. Where does data come from — full collection, visible subset, or search results?
5. What is the primary action? (At most one high-emphasis button per area.)
6. Are loading/empty/error/success states all defined?

## Execution Flow

1. **Verify facts** — search existing modules/components/hooks/types for the same meaning; don't duplicate.
2. **Define scope** — core object, field owners, data collection, action scope, busy scope, submit boundary.
3. **Delete first** — remove duplicate state, entries, confirmations, single-component visual patches, pseudo-operations, legacy code.
4. **Choose structure** — list/table/worksheet/selector/modal based on task type.
5. **Fix the real location** — fix data scope, action scope, parent layout, shared component default behavior; don't patch at the page usage site.
6. **Verify** — run existing typecheck/lint/test/build related to changes.
