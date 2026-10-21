import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

import { createRenderer, nextTick, ref } from 'vue'

const session = {
	skinSitePlayers: ref([]),
	selectedSkinSitePlayerId: ref(null),
	skinSiteStatus: ref('signed-in'),
	skinSitePlayersStatus: ref('ready'),
}
const testGlobal = globalThis as unknown as {
	previewTestSession: typeof session
	previewNormalize: (skin: { texture: string }) => Promise<string>
	previewFetchImage: (url: string) => Promise<string>
}
testGlobal.previewTestSession = session
const require = createRequire(import.meta.url)
const { parse, compileScript } = require('vue/compiler-sfc')
const componentUrl = new URL('./SkinSitePlayerPreview.vue', import.meta.url).href
const stubs: Record<string, string> = {
	'@modrinth/assets': 'export const RefreshCwIcon={}, SpinnerIcon={}, UserIcon={}',
	'@modrinth/ui':
		'export const ButtonStyled={}; export const commonMessages={retryButton:{defaultMessage:"Retry"}}; export const defineMessages=x=>x; export const useVIntl=()=>({formatMessage:x=>x.defaultMessage})',
	'vue-router': 'export const useRouter=()=>({push:async()=>{}})',
	'@/helpers/skin-site-render':
		'export const fetchImageAsDataUrl=url=>globalThis.previewFetchImage(url)',
	'@modrinth/ui/src/components/skin/SkinPreviewRenderer.vue': 'export default {}',
	'./SkinSiteSelectionRail.vue': 'export default {}',
	'@/composables/skin-site-session':
		'export const {skinSitePlayers,selectedSkinSitePlayerId,skinSiteStatus,skinSitePlayersStatus}=globalThis.previewTestSession; export const requestSkinSitePlayers=async()=>[]',
	'@/helpers/skins':
		'export const get_normalized_skin_texture=skin=>globalThis.previewNormalize(skin)',
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
				compileScript(descriptor, { id: 'player-preview-test' }).content,
			),
			shortCircuit: true,
		}
	},
})
const { default: Preview } = await import(componentUrl)
hooks.deregister()
Preview.render = () => null
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

function mountPreview(t: test.TestContext, card: unknown) {
	const app = renderer.createApp(Preview)
	app.provide('accountsCard', card)
	const instance = app.mount({})
	t.after(() => app.unmount())
	return (
		instance.$ as unknown as {
			setupState: {
				texture: string
				textureLoading: boolean
				textureFailed: boolean
				capeTexture: string
				retryTexture: () => Promise<void>
			}
		}
	).setupState
}

test('a failed skin load is recoverable without changing the selected player', async (t) => {
	const card = ref({
		accounts: [{ profile: { id: 'first', name: 'First' }, account_type: 'microsoft' }],
		defaultUser: 'first',
		getAccountSkin: () => ({ texture: 'https://textures.test/skin.png', variant: 'CLASSIC' }),
		getAccountAvatarUrl: () => undefined,
	})
	let available = false
	testGlobal.previewNormalize = async () => {
		if (!available) throw new Error('Network unavailable')
		return 'data:image/png;base64,recovered-skin'
	}
	const state = mountPreview(t, card)
	await flush()
	assert.equal(state.textureFailed, true)
	assert.equal(state.texture, '')
	available = true
	await state.retryTexture()
	assert.equal(state.textureFailed, false)
	assert.equal(state.texture, 'data:image/png;base64,recovered-skin')
	assert.equal(card.value.defaultUser, 'first')
})

test('cape downloads follow the active player and discard a late previous cape', async (t) => {
	const card = ref({
		accounts: ['first', 'second'].map((id) => ({
			profile: {
				id,
				name: id,
				capes: [
					{ id: 'inactive', state: 'INACTIVE', url: 'https://textures.test/inactive.png' },
					{ id, state: 'ACTIVE', url: `https://textures.test/${id}-cape.png` },
				],
			},
			account_type: 'microsoft',
		})),
		defaultUser: 'first',
		getAccountSkin: () => ({ texture: 'https://textures.test/skin.png', variant: 'CLASSIC' }),
		getAccountAvatarUrl: () => undefined,
	})
	testGlobal.previewNormalize = async () => 'data:image/png;base64,skin'
	const requests: Array<{ url: string; finish: (texture: string) => void }> = []
	testGlobal.previewFetchImage = (url) => new Promise((finish) => requests.push({ url, finish }))
	const state = mountPreview(t, card)
	await flush()
	assert.equal(requests[0]?.url, 'https://textures.test/first-cape.png')
	card.value.defaultUser = 'second'
	await flush()
	requests[1].finish('data:image/png;base64,second-cape')
	await flush()
	requests[0].finish('data:image/png;base64,first-cape')
	await flush()
	assert.equal(state.capeTexture, 'data:image/png;base64,second-cape')
	assert.equal(state.texture, 'data:image/png;base64,skin')
})

test('changing only a cape keeps the current skin loaded', async (t) => {
	const profile = {
		id: 'first',
		name: 'First',
		capes: [{ id: 'cape', state: 'ACTIVE', url: 'https://textures.test/cape.png' }],
	}
	const card = ref({
		accounts: [{ profile, account_type: 'microsoft' }],
		defaultUser: 'first',
		getAccountSkin: () => ({ texture: 'https://textures.test/skin.png', variant: 'CLASSIC' }),
		getAccountAvatarUrl: () => undefined,
	})
	let normalizations = 0
	testGlobal.previewNormalize = async () => {
		normalizations++
		return 'data:image/png;base64,skin'
	}
	testGlobal.previewFetchImage = async (url) =>
		`data:image/png;base64,${url.endsWith('/new.png') ? 'new' : 'old'}`
	const state = mountPreview(t, card)
	await flush()
	card.value.accounts[0].profile.capes[0].url = 'https://textures.test/new.png'
	await flush()
	assert.equal(state.capeTexture, 'data:image/png;base64,new')
	assert.equal(state.texture, 'data:image/png;base64,skin')
	assert.equal(normalizations, 1)
})

test('home normalizes official textures and ignores a late texture after switching players', async (t) => {
	const accounts = [
		{ profile: { id: 'first', name: 'First' }, account_type: 'microsoft' },
		{ profile: { id: 'second', name: 'Second' }, account_type: 'microsoft' },
	]
	const card = ref({
		accounts,
		defaultUser: 'first',
		getAccountSkin: (account: (typeof accounts)[number]) => ({
			texture: `https://textures.test/${account.profile.id}.png`,
			variant: 'CLASSIC',
		}),
		getAccountAvatarUrl: () => undefined,
	})
	const requests: Array<{ texture: string; finish: (texture: string) => void }> = []
	testGlobal.previewNormalize = (skin) =>
		new Promise((resolve) => requests.push({ texture: skin.texture, finish: resolve }))
	const state = mountPreview(t, card)
	assert.equal(requests[0].texture, 'https://textures.test/first.png')
	card.value.defaultUser = 'second'
	await flush()
	assert.equal(state.texture, '')
	requests[1].finish('data:image/png;base64,normalized-second')
	await flush()
	requests[0].finish('data:image/png;base64,normalized-first')
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,normalized-second')
	assert.equal(state.textureLoading, false)
})

test('account polling, avatar updates and another player changing skin keep the current preview loaded', async (t) => {
	const avatar = ref('first-head')
	const skins = ref<Record<string, { texture: string; variant: 'CLASSIC' | 'SLIM' }>>({
		first: { texture: 'https://textures.test/first.png', variant: 'CLASSIC' },
		second: { texture: 'https://textures.test/second.png', variant: 'CLASSIC' },
	})
	const card = ref({
		accounts: [
			{ profile: { id: 'first', name: 'First' }, account_type: 'microsoft' },
			{ profile: { id: 'second', name: 'Second' }, account_type: 'microsoft' },
		],
		defaultUser: 'first',
		getAccountSkin: (account: { profile: { id: string } }) => skins.value[account.profile.id],
		getAccountAvatarUrl: () => avatar.value,
	})
	const requests: string[] = []
	testGlobal.previewNormalize = (skin) => {
		requests.push(skin.texture)
		return requests.length === 1
			? Promise.resolve('data:image/png;base64,current-skin')
			: new Promise(() => {})
	}
	const state = mountPreview(t, card)
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,current-skin')

	card.value.accounts = card.value.accounts.map((account) => ({
		...account,
		profile: { ...account.profile },
	}))
	await flush()
	assert.equal(
		state.texture,
		'data:image/png;base64,current-skin',
		'polling must not clear the visible skin',
	)
	assert.equal(requests.length, 1, 'unchanged accounts must not normalize the skin again')

	avatar.value = 'updated-head'
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,current-skin')
	assert.equal(requests.length, 1, 'avatar-only changes must not reload the 3D skin')

	skins.value.second = { texture: 'https://textures.test/second-new.png', variant: 'SLIM' }
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,current-skin')
	assert.equal(state.textureLoading, false)
	assert.equal(
		requests.length,
		1,
		'another player changing skin must not reload the current preview',
	)
})

test('the current player changing texture or model still reloads the preview', async (t) => {
	const skin = ref({ texture: 'https://textures.test/original.png', variant: 'CLASSIC' })
	const card = ref({
		accounts: [{ profile: { id: 'first', name: 'First' }, account_type: 'microsoft' }],
		defaultUser: 'first',
		getAccountSkin: () => skin.value,
		getAccountAvatarUrl: () => undefined,
	})
	const requests: string[] = []
	testGlobal.previewNormalize = async (current) => {
		requests.push(current.texture)
		return `data:image/png;base64,skin-${requests.length}`
	}
	const state = mountPreview(t, card)
	await flush()
	skin.value.texture = 'https://textures.test/updated.png'
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,skin-2')
	skin.value.variant = 'SLIM'
	await flush()
	assert.equal(state.texture, 'data:image/png;base64,skin-3')
	assert.deepEqual(requests, [
		'https://textures.test/original.png',
		'https://textures.test/updated.png',
		'https://textures.test/updated.png',
	])
})
