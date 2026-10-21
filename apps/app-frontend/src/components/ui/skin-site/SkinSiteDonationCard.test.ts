import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick } from 'vue'

const testGlobal = globalThis as unknown as { homeDonationSummaryFetch: () => Promise<unknown> }
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./SkinSiteDonationCard.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const ChevronRightIcon={}, HeartIcon={}, SpinnerIcon={}',
	'@modrinth/ui':
		'export const ButtonStyled={},commonMessages={retryButton:{defaultMessage:"Retry"}}; export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	'./SkinSiteDonationModal.vue': 'export default {}',
	'@/helpers/skin-site-api':
		'export const skinSitePublicDonationSummary=()=>globalThis.homeDonationSummaryFetch()',
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
			source: stripTypeScriptTypes(compileScript(descriptor, { id: 'donation-card-test' }).content),
			shortCircuit: true,
		}
	},
})
const { default: Card } = await import(componentUrl)
hooks.deregister()
Card.render = () => null
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
type Summary = { totalAmount: string; donorCount: number }
type State = {
	summary: Summary | null
	failed: boolean
	loading: boolean
	loadSummary?: () => Promise<void>
	applySummary?: (summary: Summary) => void
}
function mount(t: test.TestContext) {
	const app = renderer.createApp(Card)
	const instance = app.mount({})
	t.after(() => app.unmount())
	return (instance.$ as unknown as { setupState: State }).setupState
}
const flush = async () => {
	await new Promise((resolve) => setImmediate(resolve))
	await nextTick()
}

test('the donation summary can recover from an initial network failure', async (t) => {
	testGlobal.homeDonationSummaryFetch = async () => {
		throw new Error('Offline')
	}
	const state = mount(t)
	await flush()
	assert.equal(state.failed, true)
	testGlobal.homeDonationSummaryFetch = async () => ({
		success: true,
		payload: { totalAmount: '80.25', donorCount: 2 },
	})
	await state.loadSummary?.()
	assert.equal(state.failed, false)
	assert.deepEqual(state.summary, { totalAmount: '80.25', donorCount: 2 })
})

test('a summary from the donation list wins over an older initial request', async (t) => {
	let finish!: (result: unknown) => void
	testGlobal.homeDonationSummaryFetch = () =>
		new Promise((resolve) => {
			finish = resolve
		})
	const state = mount(t)
	const updated = { totalAmount: '99.50', donorCount: 3 }
	state.applySummary?.(updated)
	assert.deepEqual(state.summary, updated)
	assert.equal(state.loading, false)
	finish({ success: true, payload: { totalAmount: '20.00', donorCount: 1 } })
	await flush()
	assert.deepEqual(state.summary, updated)
	assert.equal(state.failed, false)
})
