import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick, ref } from 'vue'

const testSession = {
	skinSiteStatus: ref('checking'),
	skinSiteUser: ref<{ uuid: string } | null>(null),
}
const testGlobal = globalThis as unknown as {
	skinSiteAnnouncementSession: typeof testSession
	skinSiteAnnouncementFetch: () => Promise<unknown>
}
testGlobal.skinSiteAnnouncementSession = testSession
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./SkinSiteAnnouncements.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const NewspaperIcon={}, SpinnerIcon={}, StarIcon={}',
	'@modrinth/ui':
		'export const commonMessages={retryButton:{defaultMessage:"Retry"}}; export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	'@/helpers/skin-site-api':
		'export const skinSiteAnnouncements=()=>globalThis.skinSiteAnnouncementFetch()',
	'@/composables/skin-site-session':
		'export const {skinSiteStatus,skinSiteUser}=globalThis.skinSiteAnnouncementSession; export const reloadSkinSiteSession=async()=>{}',
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@/helpers/remote-announcements')
			return nextResolve(
				new URL('../../../helpers/remote-announcements.ts', import.meta.url).href,
				context,
			)
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
				compileScript(descriptor, { id: 'skin-announcement-test' }).content,
			),
			shortCircuit: true,
		}
	},
})
const { default: Announcements } = await import(componentUrl)
hooks.deregister()
Announcements.render = () => null

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
const flush = async () => {
	await new Promise((resolve) => setImmediate(resolve))
	await nextTick()
}
type State = {
	announcements: Array<{ id: number }>
	loading: boolean
	failed: boolean
	load: () => Promise<void>
}
let requests = 0
function mount(t: test.TestContext) {
	const app = renderer.createApp(Announcements)
	const instance = app.mount({})
	t.after(() => app.unmount())
	return instance.$.setupState as State
}
test.beforeEach(() => {
	testSession.skinSiteStatus.value = 'checking'
	testSession.skinSiteUser.value = null
	requests = 0
	testGlobal.skinSiteAnnouncementFetch = async () => {
		requests++
		return { success: true, payload: [{ id: 1, title: '公告', updateAt: 1, star: false }] }
	}
})

test('announcements wait for startup renewal and reload when sign-in finishes', async (t) => {
	const state = mount(t)
	await flush()
	assert.equal(requests, 0)
	assert.equal(state.loading, true)
	testSession.skinSiteUser.value = { uuid: 'owner' }
	testSession.skinSiteStatus.value = 'signed-in'
	await flush()
	assert.equal(requests, 1)
	assert.equal(state.announcements.length, 1)
})

test('signed-out users do not request protected announcements or see a load failure', async (t) => {
	testSession.skinSiteStatus.value = 'signed-out'
	const state = mount(t)
	await flush()
	assert.equal(requests, 0)
	assert.equal(state.loading, false)
	assert.equal(state.failed, false)
})

test('signing out clears announcements and ignores an old in-flight response', async (t) => {
	testSession.skinSiteStatus.value = 'signed-in'
	let finish!: (value: unknown) => void
	testGlobal.skinSiteAnnouncementFetch = () =>
		new Promise((resolve) => {
			finish = resolve
		})
	const state = mount(t)
	await flush()
	testSession.skinSiteStatus.value = 'signed-out'
	await flush()
	finish({ success: true, payload: [{ id: 2 }] })
	await flush()
	assert.deepEqual(state.announcements, [])
	assert.equal(state.failed, false)
})

test('a failed announcement request can be retried', async (t) => {
	testSession.skinSiteStatus.value = 'signed-in'
	testGlobal.skinSiteAnnouncementFetch = async () => ({ success: false })
	const state = mount(t)
	await flush()
	assert.equal(state.failed, true)
	testGlobal.skinSiteAnnouncementFetch = async () => ({ success: true, payload: [{ id: 3 }] })
	await state.load()
	assert.equal(state.failed, false)
	assert.equal(state.announcements[0].id, 3)
})

test('the home announcement list retains entries beyond the five-item preview', async (t) => {
	testSession.skinSiteStatus.value = 'signed-in'
	testGlobal.skinSiteAnnouncementFetch = async () => ({
		success: true,
		payload: Array.from({ length: 7 }, (_, index) => ({
			id: index + 1,
			title: 'Announcement',
			updateAt: index,
			star: false,
		})),
	})
	const state = mount(t)
	await flush()
	assert.equal(state.announcements.length, 7)
	assert.equal(state.announcements[0].id, 7)
})
