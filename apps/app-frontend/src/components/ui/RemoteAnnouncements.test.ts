import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick, ref } from 'vue'

import {
	OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT,
	type RemoteAnnouncement,
} from '../../helpers/remote-announcements.ts'

const testGlobal = globalThis as unknown as {
	homeAnnouncementSession: { skinSiteStatus: ReturnType<typeof ref> }
}
testGlobal.homeAnnouncementSession = { skinSiteStatus: ref('signed-out') }
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./RemoteAnnouncements.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/ui':
		'import {ref} from "vue"; export const Button={},NewModal={},commonMessages={closeButton:{defaultMessage:"Close"}}; export const useModalStack=()=>({hasModal:ref(false)}); export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	'@modrinth/utils': 'export const renderString=x=>x',
	'@tauri-apps/plugin-http':
		'export const fetch=async()=>{throw new Error("Unexpected network request")}',
	'@tauri-apps/plugin-opener': 'export const openUrl=async()=>{}',
	'@/composables/skin-site-session.ts':
		'export const {skinSiteStatus}=globalThis.homeAnnouncementSession; export const waitForSkinSiteSession=async()=>{}; export const requestSkinSiteDownloadToken=async()=>"token"',
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'vue' && context.parentURL?.startsWith('data:'))
			return nextResolve(specifier, { ...context, parentURL: import.meta.url })
		if (specifier in stubs)
			return {
				url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
				shortCircuit: true,
			}
		if (specifier === '@/helpers/remote-announcements')
			return nextResolve(
				new URL('../../helpers/remote-announcements.ts', import.meta.url).href,
				context,
			)
		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url !== componentUrl) return nextLoad(url, context)
		const { descriptor } = parse(readFileSync(new URL(url), 'utf8'))
		return {
			format: 'module',
			source: stripTypeScriptTypes(
				compileScript(descriptor, { id: 'remote-announcements-test' }).content,
			),
			shortCircuit: true,
		}
	},
})
const { default: Center } = await import(componentUrl)
hooks.deregister()
Center.render = () => null
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
const announcement = (id: string): RemoteAnnouncement => ({
	id,
	title: id,
	summary: 'Summary',
	content: 'Full announcement',
	type: 'notification',
	priority: 'normal',
	starts_at: '2026-01-01T00:00:00Z',
	ends_at: null,
	published_at: '2026-01-01T00:00:00Z',
	action_url: null,
	action_label: null,
})
type State = {
	selected: RemoteAnnouncement | null
	startupNotice: RemoteAnnouncement | null
	read: Set<string>
	markAllRead: () => void
	sync: (items: RemoteAnnouncement[], fresh: boolean) => void
}
function mount(t: test.TestContext) {
	const restore: Array<() => void> = []
	for (const [key, value] of Object.entries({
		window: new EventTarget(),
		localStorage: { getItem: () => null, setItem() {} },
		requestIdleCallback: () => 1,
	})) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, key)
		Object.defineProperty(globalThis, key, { configurable: true, value })
		restore.push(() => {
			if (previous) Object.defineProperty(globalThis, key, previous)
			else Reflect.deleteProperty(globalThis, key)
		})
	}
	const app = renderer.createApp(Center, { ready: true })
	const instance = app.mount({})
	t.after(() => {
		app.unmount()
		for (const reset of restore) reset()
	})
	return (instance.$ as unknown as { setupState: State }).setupState
}

test('opening a home announcement selects its full content and marks that announcement read', async (t) => {
	const state = mount(t)
	state.sync([announcement('first'), announcement('second')], false)
	window.dispatchEvent(
		new CustomEvent(OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT, {
			detail: { announcement: announcement('second') },
		}),
	)
	await nextTick()
	assert.equal(state.selected?.id, 'second')
	assert.equal(state.selected?.content, 'Full announcement')
	assert.equal(state.read.has('second:2026-01-01T00:00:00Z'), true)
	assert.equal(state.read.has('first:2026-01-01T00:00:00Z'), false)
})

test('an invalid announcement request cannot inject an unsafe action into the reader', async (t) => {
	const state = mount(t)
	state.sync([announcement('first')], false)
	window.dispatchEvent(
		new CustomEvent(OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT, {
			detail: { announcement: { ...announcement('unsafe'), action_url: 'javascript:alert(1)' } },
		}),
	)
	await nextTick()
	assert.equal(state.selected?.id, 'first')
})

test('reading the current unread popup through the full list clears that popup', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const state = mount(t)
	state.sync([announcement('first')], true)
	assert.equal(state.startupNotice?.id, 'first')
	window.dispatchEvent(new CustomEvent(OPEN_REMOTE_ANNOUNCEMENT_CENTER_EVENT))
	await nextTick()
	assert.equal(state.startupNotice, null)
	assert.equal(state.read.has('first:2026-01-01T00:00:00Z'), true)
})

test('marking every announcement read also clears the unread popup', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const state = mount(t)
	state.sync([announcement('first')], true)
	state.markAllRead()
	assert.equal(state.startupNotice, null)
	assert.equal(state.read.has('first:2026-01-01T00:00:00Z'), true)
})
