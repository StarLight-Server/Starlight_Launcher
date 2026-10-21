import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick } from 'vue'

const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./SkinSiteSelectionRail.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/ui': 'export const Avatar={}',
	'@vueuse/core': 'export const useResizeObserver=()=>{}',
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier in stubs)
			return {
				url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
				shortCircuit: true,
			}
		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url !== componentUrl) return nextLoad(url, context)
		const { descriptor } = parse(readFileSync(new URL(url), 'utf8'))
		return {
			format: 'module',
			source: stripTypeScriptTypes(
				compileScript(descriptor, { id: 'selection-rail-test' }).content,
			),
			shortCircuit: true,
		}
	},
})
const { default: Rail } = await import(componentUrl)
hooks.deregister()
Rail.render = () => null
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

test('a selected avatar outside the rail scrolls only its own viewport into view', async (t) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
	Object.defineProperty(globalThis, 'requestAnimationFrame', {
		configurable: true,
		value: (callback: () => void) => {
			callback()
			return 1
		},
	})
	const app = renderer.createApp(Rail, {
		items: [{ id: 'player', label: 'Player' }],
		selected: 'player',
		label: 'Players',
		vertical: true,
	})
	const instance = app.mount({})
	t.after(() => {
		app.unmount()
		if (previous) Object.defineProperty(globalThis, 'requestAnimationFrame', previous)
		else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
	})
	await nextTick()
	const state = (
		instance.$ as unknown as {
			setupState: {
				rail: unknown
				viewport: unknown
				updateIndicator: (reveal?: boolean) => Promise<void>
			}
		}
	).setupState
	const scrolls: number[] = []
	const button = {
		offsetLeft: 0,
		offsetTop: 350,
		offsetWidth: 48,
		offsetHeight: 48,
		getBoundingClientRect: () => ({ top: 450, bottom: 498 }),
	}
	state.rail = { querySelector: () => button }
	state.viewport = {
		scrollTop: 0,
		clientHeight: 200,
		clientTop: 0,
		getBoundingClientRect: () => ({ top: 100 }),
		scrollTo: ({ top }: { top: number }) => scrolls.push(top),
	}
	await state.updateIndicator(true)
	assert.equal(scrolls.length, 1)
	assert.ok(
		scrolls[0] >= 198 && scrolls[0] <= 350,
		'the selected avatar must fit entirely inside its scroll viewport',
	)
	button.getBoundingClientRect = () => ({ top: 150, bottom: 198 })
	await state.updateIndicator(true)
	assert.equal(scrolls.length, 1, 'an already visible avatar must not scroll again')
})
