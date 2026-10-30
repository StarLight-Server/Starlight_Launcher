import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, h, nextTick, reactive } from 'vue'

const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./InstanceNavTabs.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const PencilIcon={},GripVerticalIcon={},RefreshCwIcon={}',
	'@modrinth/ui':
		'export const NavTabs={},ButtonStyled={},commonMessages={saveButton:{},cancelButton:{}}; export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	vuedraggable: 'export default {}',
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
			source: stripTypeScriptTypes(compileScript(descriptor, { id: 'instance-nav-test' }).content),
			shortCircuit: true,
		}
	},
})
const { default: Navigation } = await import(componentUrl)
hooks.deregister()
Navigation.render = () => null

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
type Link = { id: string; label: string; href: string }
type State = {
	editing: boolean
	draft: Link[]
	orderedLinks: Link[]
	saveFailed: boolean
	saving: boolean
	startEditing: () => void
	cancelEditing: () => void
	resetOrder: () => void
	saveOrder: () => Promise<void>
}
const defaults = ['content', 'files', 'screenshots', 'worlds', 'logs']
function mount(t: test.TestContext, initial = [...defaults], failWrite = false) {
	const settings = reactive({ order: initial })
	let state: State
	let saves = 0
	let waitForSave: Promise<void> = Promise.resolve()
	const app = renderer.createApp({
		setup: () => () =>
			h(Navigation, {
				links: settings.order.map((id) => ({ id, label: id, href: '/instance/first/' + id })),
				defaultOrder: defaults,
				saveOrder: async (order: string[]) => {
					saves++
					await waitForSave
					if (failWrite) throw new Error('Settings unavailable')
					settings.order = order
					await nextTick()
				},
				ref: (vm: unknown) => {
					if (vm) state = (vm as { $: { setupState: State } }).$.setupState
				},
			}),
	})
	app.mount({})
	t.after(() => app.unmount())
	return {
		state: state!,
		settings,
		saves: () => saves,
		delay: (promise: Promise<void>) => {
			waitForSave = promise
		},
	}
}
const ids = (items: Link[]) => items.map((item) => item.id)

test('saving an inline reorder updates the same settings used by the parent', async (t) => {
	const { state, settings } = mount(t)
	state.startEditing()
	state.draft = [state.draft[4], ...state.draft.slice(0, 4)]
	await state.saveOrder()
	assert.equal(state.editing, false)
	assert.deepEqual(settings.order, ['logs', 'content', 'files', 'screenshots', 'worlds'])
	assert.deepEqual(ids(state.orderedLinks), settings.order)
})

test('appearance settings changes take effect after an inline order has been saved', async (t) => {
	const { state, settings } = mount(t)
	state.startEditing()
	state.draft.reverse()
	await state.saveOrder()
	settings.order = ['files', 'content', 'screenshots', 'worlds', 'logs']
	await nextTick()
	assert.deepEqual(ids(state.orderedLinks), settings.order)
})

test('cancel discards the draft without saving settings', (t) => {
	const { state, settings, saves } = mount(t, ['logs', 'files', 'content', 'worlds', 'screenshots'])
	state.startEditing()
	state.draft.reverse()
	state.cancelEditing()
	assert.equal(state.editing, false)
	assert.deepEqual(ids(state.orderedLinks), settings.order)
	assert.equal(saves(), 0)
})

test('restore defaults uses canonical order rather than the current appearance setting', async (t) => {
	const { state, settings } = mount(t, ['logs', 'files', 'content', 'worlds', 'screenshots'])
	state.startEditing()
	state.resetOrder()
	assert.deepEqual(ids(state.draft), defaults)
	assert.deepEqual(settings.order, ['logs', 'files', 'content', 'worlds', 'screenshots'])
	await state.saveOrder()
	assert.deepEqual(settings.order, defaults)
})

test('failed persistence keeps the draft editable and the previous settings intact', async (t) => {
	const { state, settings } = mount(t, [...defaults], true)
	state.startEditing()
	state.draft.reverse()
	await state.saveOrder()
	assert.equal(state.editing, true)
	assert.equal(state.saveFailed, true)
	assert.deepEqual(ids(state.draft), [...defaults].reverse())
	assert.deepEqual(settings.order, defaults)
})

test('a pending save cannot be submitted twice or reset', async (t) => {
	let complete!: () => void
	const pending = new Promise<void>((resolve) => {
		complete = resolve
	})
	const fixture = mount(t)
	fixture.delay(pending)
	fixture.state.startEditing()
	fixture.state.draft.reverse()
	const save = fixture.state.saveOrder()
	assert.equal(fixture.state.saving, true)
	await fixture.state.saveOrder()
	fixture.state.resetOrder()
	assert.deepEqual(ids(fixture.state.draft), [...defaults].reverse())
	assert.equal(fixture.saves(), 1)
	complete()
	await save
	assert.equal(fixture.state.saving, false)
})

test('starting a new edit after cancel restores the current parent order', async (t) => {
	const { state } = mount(t)
	state.startEditing()
	state.draft.reverse()
	state.cancelEditing()
	await nextTick()
	state.startEditing()
	assert.deepEqual(ids(state.draft), defaults)
})
