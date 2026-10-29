import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, reactive } from 'vue'

const route = reactive({ path: '/instance/demo/files', query: {} })
const globals = globalThis as unknown as { navTabsTestRoute: typeof route }
globals.navTabsTestRoute = route
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./NavTabs.vue', import.meta.url).href
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'vue-router')
			return {
				url: 'data:text/javascript,export const RouterLink={}; export const useRoute=()=>globalThis.navTabsTestRoute',
				shortCircuit: true,
			}
		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url !== componentUrl) return nextLoad(url, context)
		const { descriptor } = parse(readFileSync(new URL(url), 'utf8'))
		return {
			format: 'module',
			source: stripTypeScriptTypes(compileScript(descriptor, { id: 'nav-tabs-test' }).content),
			shortCircuit: true,
		}
	},
})
const { default: Tabs } = await import(componentUrl)
hooks.deregister()
Tabs.render = () => null
type Node = Record<string, unknown>
const renderer = createRenderer<Node, Node>({
	createElement: () => ({}),
	createText: () => ({}),
	createComment: () => ({}),
	insert() {},
	remove() {},
	setText() {},
	setElementText() {},
	patchProp() {},
	parentNode: () => null,
	nextSibling: () => null,
})
function active(t: test.TestContext, path: string) {
	route.path = path
	const app = renderer.createApp(Tabs, {
		links: [
			{ label: 'Files', href: '/instance/demo/files' },
			{ label: 'Logs', href: '/instance/demo/logs' },
			{ label: 'Content', href: '/instance/demo' },
		],
	})
	const vm = app.mount({})
	t.after(() => app.unmount())
	return (
		vm.$ as unknown as { setupState: { computeActiveIndex: () => unknown } }
	).setupState.computeActiveIndex()
}
test('an exact page stays selected when its parent tab is moved after it', (t) => {
	assert.deepEqual(active(t, '/instance/demo/files'), { index: 0, isSubpage: false })
})
test('a nested page selects the most specific parent regardless of tab order', (t) => {
	assert.deepEqual(active(t, '/instance/demo/files/editor'), { index: 0, isSubpage: true })
})
test('a different instance does not match a tab through a partial path prefix', (t) => {
	assert.deepEqual(active(t, '/instance/demo-other/files'), { index: -1, isSubpage: false })
})
