import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick, shallowRef } from 'vue'

type Failure = {
	id: number
	kind: string
	details: string
	retry?: () => Promise<unknown>
}
const failures = shallowRef<Failure[]>([])
const navigations: string[] = []
let rejectNavigation = false
const shared = globalThis as unknown as {
	hostedModalTest: {
		failures: typeof failures
		dismiss: (id: number) => void
		navigate: (path: string) => Promise<void>
	}
}
shared.hostedModalTest = {
	failures,
	dismiss: (id) => {
		failures.value = failures.value.filter((failure) => failure.id !== id)
	},
	navigate: async (path) => {
		navigations.push(path)
		if (rejectNavigation) throw new Error('Navigation failed')
	},
}

const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./HostedInstallErrorModal.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const CircleAlertIcon={}, CopyIcon={}, CheckIcon={}',
	'@modrinth/ui': `export const ButtonStyled={}, NewModal={}, commonMessages={closeButton:{defaultMessage:'Close'}}; export const defineMessages=x=>x; export const injectNotificationManager=()=>({addNotification:()=>{},handleError:()=>{}}); export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})`,
	'vue-router': 'export const useRouter=()=>({push:globalThis.hostedModalTest.navigate})',
	'@/composables/hosted-install-errors':
		'export const hostedInstallFailures=globalThis.hostedModalTest.failures; export const dismissHostedInstallFailure=globalThis.hostedModalTest.dismiss',
	'@/components/ui/skin-site/SkinSiteLoginModal.vue': 'export default {}',
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier in stubs) {
			return {
				url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
				shortCircuit: true,
			}
		}
		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url !== componentUrl) return nextLoad(url, context)
		const { descriptor } = parse(readFileSync(new URL(url), 'utf8'))
		return {
			format: 'module',
			source: stripTypeScriptTypes(
				compileScript(descriptor, { id: 'hosted-error-modal-test' }).content,
			),
			shortCircuit: true,
		}
	},
})
const { default: Modal } = await import(componentUrl)
hooks.deregister()
Modal.render = () => null

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
	displayed: Failure | undefined
	modal: { show: () => void; hide: () => Promise<void> }
	onHide: () => void
	onAfterHide: () => void
	onSignedIn: () => void
	openLogin: () => void
	canRetry: boolean
	retry: () => Promise<void>
}
const flush = async () => {
	await nextTick()
	await nextTick()
}
function mount(t: test.TestContext) {
	const app = renderer.createApp(Modal)
	const vm = app.mount({})
	const state = (vm.$ as unknown as { setupState: State }).setupState
	let afterHide: (() => void) | undefined
	state.modal = {
		show() {},
		hide: () => {
			state.onHide()
			return new Promise<void>((resolve) => {
				afterHide = () => {
					state.onAfterHide()
					resolve()
				}
			})
		},
	}
	t.after(() => app.unmount())
	return { state, finishHide: () => afterHide?.() }
}
test.beforeEach(() => {
	failures.value = []
	navigations.length = 0
	rejectNavigation = false
})

test('keeps the closing failure until its transition ends and then shows the next failure', async (t) => {
	const { state, finishHide } = mount(t)
	failures.value = [
		{ id: 1, kind: 'network', details: 'offline' },
		{ id: 2, kind: 'runtime', details: 'java' },
	]
	await flush()
	assert.equal(state.displayed?.id, 1)
	void state.modal.hide()
	await flush()
	assert.equal(state.displayed?.id, 1)
	assert.equal(failures.value.length, 2)
	finishHide()
	await flush()
	assert.deepEqual(
		failures.value.map((failure) => failure.id),
		[2],
	)
	assert.equal(state.displayed?.id, 2)
})

test('login success enables retry without starting the failed download automatically', async (t) => {
	const { state } = mount(t)
	let attempts = 0
	failures.value = [
		{
			id: 1,
			kind: 'login',
			details: 'expired',
			retry: async () => {
				attempts++
				return 'new'
			},
		},
	]
	await flush()
	assert.equal(state.canRetry, false)
	state.openLogin()
	state.onSignedIn()
	await flush()
	assert.equal(state.canRetry, true)
	assert.equal(attempts, 0)
	assert.equal(state.displayed?.id, 1)
})

test('retry waits for dismissal and opens a newly created instance without a launch query', async (t) => {
	const { state, finishHide } = mount(t)
	let attempts = 0
	failures.value = [
		{
			id: 1,
			kind: 'network',
			details: 'offline',
			retry: async () => {
				attempts++
				return 'local:one'
			},
		},
	]
	await flush()
	const pending = state.retry()
	assert.equal(attempts, 0)
	finishHide()
	await pending
	assert.equal(attempts, 1)
	assert.deepEqual(navigations, ['/downloads', '/instance/local%3Aone/'])
	assert.equal(failures.value.length, 0)
})

test('a retry failure queued during the retry remains visible', async (t) => {
	const { state, finishHide } = mount(t)
	failures.value = [
		{
			id: 1,
			kind: 'network',
			details: 'offline',
			retry: async () => {
				failures.value = [{ id: 2, kind: 'network', details: 'still offline' }]
				throw new Error('still offline')
			},
		},
	]
	await flush()
	const pending = state.retry()
	finishHide()
	await pending
	await flush()
	assert.equal(state.displayed?.id, 2)
})

test('clearing the displayed failure closes it without dismissing the next queued failure', async (t) => {
	const { state, finishHide } = mount(t)
	failures.value = [
		{ id: 1, kind: 'network', details: 'old attempt' },
		{ id: 2, kind: 'runtime', details: 'another instance' },
	]
	await flush()
	failures.value = failures.value.filter((failure) => failure.id !== 1)
	await flush()
	assert.equal(state.displayed?.id, 1)
	finishHide()
	await flush()
	assert.equal(state.displayed?.id, 2)
	assert.deepEqual(
		failures.value.map((failure) => failure.id),
		[2],
	)
})

test('a navigation error does not prevent retrying the download', async (t) => {
	const { state, finishHide } = mount(t)
	let attempts = 0
	failures.value = [
		{
			id: 1,
			kind: 'network',
			details: 'offline',
			retry: async () => {
				attempts++
			},
		},
	]
	rejectNavigation = true
	await flush()
	const pending = state.retry()
	finishHide()
	await pending
	assert.equal(attempts, 1)
	assert.deepEqual(navigations, ['/downloads'])
})

test('login completion for a cleared failure cannot mark an unrelated failure ready to retry', async (t) => {
	const { state, finishHide } = mount(t)
	failures.value = [{ id: 1, kind: 'login', details: 'expired', retry: async () => {} }]
	await flush()
	state.openLogin()
	failures.value = [{ id: 2, kind: 'configuration', details: 'bad release', retry: async () => {} }]
	await flush()
	finishHide()
	await flush()
	state.onSignedIn()
	await flush()
	assert.equal(state.displayed?.id, 2)
	assert.equal(state.canRetry, false)
})

for (const kind of ['disk-space', 'permission', 'busy']) {
	test(`a ${kind} error before instance creation can retry the original operation`, async (t) => {
		const { state, finishHide } = mount(t)
		let attempts = 0
		failures.value = [
			{
				id: 1,
				kind,
				details: 'Cannot create the instance directory',
				retry: async () => {
					attempts++
					return 'local:created'
				},
			},
		]
		await flush()
		assert.equal(attempts, 0)
		assert.equal(state.canRetry, true)
		const pending = state.retry()
		finishHide()
		await pending
		assert.equal(attempts, 1)
		assert.deepEqual(navigations, ['/downloads', '/instance/local%3Acreated/'])
	})
}
