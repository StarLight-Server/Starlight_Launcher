import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick } from 'vue'

const testGlobal = globalThis as unknown as {
	donationTestFetch: (offset: number) => Promise<unknown>
}
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./SkinSiteDonationModal.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const HeartIcon={}, SpinnerIcon={}, StarIcon={}',
	'@modrinth/ui':
		'export const Avatar={}, ButtonStyled={}, NewModal={}, commonMessages={retryButton:{defaultMessage:"Retry"}}; export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	'@/helpers/skin-site-api':
		'export const skinSiteDonationList=offset=>globalThis.donationTestFetch(offset)',
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier in stubs)
			return {
				url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
				shortCircuit: true,
			}
		if (specifier === './donation-format')
			return nextResolve(new URL('./donation-format.ts', import.meta.url).href, context)
		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url !== componentUrl) return nextLoad(url, context)
		const { descriptor } = parse(readFileSync(new URL(url), 'utf8'))
		return {
			format: 'module',
			source: stripTypeScriptTypes(compileScript(descriptor, { id: 'donation-test' }).content),
			shortCircuit: true,
		}
	},
})
const { default: Donations } = await import(componentUrl)
hooks.deregister()
Donations.render = () => null
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
type State = {
	items: Array<{ id: number }>
	loading: boolean
	failed: boolean
	hasMore: boolean
	load: (reset?: boolean) => Promise<void>
	show: () => void
}
function mount(t: test.TestContext, props = {}) {
	const app = renderer.createApp(Donations, props)
	const instance = app.mount({})
	t.after(() => app.unmount())
	return (instance.$ as unknown as { setupState: State }).setupState
}

test('a loaded donation page updates the summary shown by its parent', async (t) => {
	const updates: unknown[] = []
	testGlobal.donationTestFetch = async () => page(1, false)
	const state = mount(t, { onSummaryUpdated: (summary: unknown) => updates.push(summary) })
	state.show()
	await flush()
	assert.deepEqual(updates, [{ totalAmount: '12.50', donorCount: 1 }])
})
const page = (id: number, hasMore = true) => ({
	success: true,
	payload: {
		items: [{ id, rank: id, username: 'Donor', avatar: null, amount: '12.50' }],
		summary: { totalAmount: '12.50', donorCount: 1 },
		hasMore,
	},
})
const flush = async () => {
	await new Promise((resolve) => setImmediate(resolve))
	await nextTick()
}

test('donations load on opening and a failed next page preserves the list and retries the same offset', async (t) => {
	const offsets: number[] = []
	let fail = false
	testGlobal.donationTestFetch = async (offset) => {
		offsets.push(offset)
		return fail ? { success: false, errorMessage: 'Offline' } : page(offset + 1, offset === 0)
	}
	const state = mount(t)
	assert.deepEqual(offsets, [])
	state.show()
	await flush()
	assert.deepEqual(
		state.items.map((item) => item.id),
		[1],
	)
	fail = true
	await state.load()
	assert.equal(state.failed, true)
	assert.deepEqual(
		state.items.map((item) => item.id),
		[1],
	)
	fail = false
	await state.load()
	assert.deepEqual(offsets, [0, 1, 1])
	assert.deepEqual(
		state.items.map((item) => item.id),
		[1, 2],
	)
	assert.equal(state.hasMore, false)
})

test('reopening the donation list discards an older in-flight page', async (t) => {
	const finish: Array<(result: unknown) => void> = []
	testGlobal.donationTestFetch = () => new Promise((resolve) => finish.push(resolve))
	const state = mount(t)
	state.show()
	state.show()
	finish[1](page(2, false))
	await flush()
	finish[0](page(1))
	await flush()
	assert.deepEqual(
		state.items.map((item) => item.id),
		[2],
	)
	assert.equal(state.loading, false)
	assert.equal(state.hasMore, false)
})
