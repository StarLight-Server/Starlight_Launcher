import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

type FetchHandler = (url: string, options: RequestInit) => Promise<Response>
const testGlobal = globalThis as unknown as {
	skinSiteTestFetch: FetchHandler
	skinSiteTestHead: (texture: string) => Promise<string>
}
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@/helpers/skin-site-render') {
			const renderer = new URL('../helpers/skin-site-render.ts', import.meta.url).href
			return {
				url: `data:text/javascript,${encodeURIComponent(`export { fetchImageAsDataUrl } from ${JSON.stringify(renderer)}; export const renderSkinHead=texture=>globalThis.skinSiteTestHead(texture)`)}`,
				shortCircuit: true,
			}
		}
		if (specifier === '@tauri-apps/plugin-http') {
			return {
				url: 'data:text/javascript,export const fetch=(...args)=>globalThis.skinSiteTestFetch(...args)',
				shortCircuit: true,
			}
		}
		if (specifier.startsWith('@/')) {
			return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context)
		}
		return nextResolve(specifier, context)
	},
})
const session = await import('./skin-site-session.ts')
hooks.deregister()

const user = { uuid: 'owner', username: 'Player', permissions: [] }
const ok = (payload: unknown) => Response.json({ payload })
const storage = new Map<string, string>()
const tokenKey = 'starlight-skin-site-token'
let calls: Array<{ path: string; token: string | undefined }> = []
let respond: FetchHandler

test.beforeEach(() => {
	storage.clear()
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		},
	})
	calls = []
	respond = async (url) => {
		if (url.endsWith('/user/refresh')) return ok({ username: 'Player', jwt: 'fresh-token' })
		if (url.endsWith('/user')) return ok(user)
		return ok([])
	}
	testGlobal.skinSiteTestFetch = async (url, options = {}) => {
		calls.push({
			path: new URL(url).pathname,
			token: (options.headers as Record<string, string>)?.Authorization,
		})
		return respond(url, options)
	}
	session.resetSkinSiteSession()
})

test.afterEach(async () => {
	session.signOutSkinSite()
	await new Promise((resolve) => setImmediate(resolve))
	Reflect.deleteProperty(globalThis, 'localStorage')
})

test('startup renews the stored JWT before loading the user with the new token', async () => {
	storage.set(tokenKey, 'old-token')
	await session.initSkinSiteSession()
	assert.deepEqual(calls.slice(0, 2), [
		{ path: '/starlight/user/refresh', token: 'Bearer old-token' },
		{ path: '/starlight/user', token: 'Bearer fresh-token' },
	])
	assert.equal(storage.get(tokenKey), 'fresh-token')
	assert.equal(session.skinSiteStatus.value, 'signed-in')
})

test('simultaneous startup consumers share one refresh', async () => {
	storage.set(tokenKey, 'old-token')
	await Promise.all([
		session.initSkinSiteSession(),
		session.initSkinSiteSession(),
		session.waitForSkinSiteSession(),
	])
	assert.equal(calls.filter((call) => call.path.endsWith('/refresh')).length, 1)
})

test('startup without a stored token does not make authenticated requests', async () => {
	await session.initSkinSiteSession()
	assert.equal(session.skinSiteStatus.value, 'signed-out')
	assert.deepEqual(calls, [])
})

test('an expired token is cleared when renewal is rejected', async () => {
	storage.set(tokenKey, 'expired-token')
	respond = async () => Response.json({ errorMessage: 'Expired' }, { status: 401 })
	await session.initSkinSiteSession()
	assert.equal(storage.has(tokenKey), false)
	assert.equal(session.skinSiteStatus.value, 'signed-out')
	assert.equal(calls.length, 1)
})

test('temporary renewal failure preserves the token and allows startup retry', async () => {
	storage.set(tokenKey, 'old-token')
	respond = async () => Response.json({ errorMessage: 'Unavailable' }, { status: 503 })
	await session.initSkinSiteSession()
	assert.equal(session.skinSiteStatus.value, 'error')
	assert.equal(storage.get(tokenKey), 'old-token')
	respond = async (url) =>
		url.endsWith('/refresh')
			? ok({ jwt: 'fresh-token' })
			: url.endsWith('/user')
				? ok(user)
				: ok([])
	await session.initSkinSiteSession()
	assert.equal(session.skinSiteStatus.value, 'signed-in')
})

test('a late refresh cannot restore a session after sign-out', async () => {
	storage.set(tokenKey, 'old-token')
	let finish!: (response: Response) => void
	respond = () =>
		new Promise((resolve) => {
			finish = resolve
		})
	const initializing = session.initSkinSiteSession()
	await new Promise((resolve) => setImmediate(resolve))
	session.signOutSkinSite()
	finish(ok({ username: 'Player', jwt: 'late-token' }))
	await initializing
	assert.equal(storage.has(tokenKey), false)
	assert.equal(session.skinSiteStatus.value, 'signed-out')
	assert.equal(session.skinSiteUser.value, null)
})

test('a malformed refresh response never replaces the saved token', async () => {
	storage.set(tokenKey, 'old-token')
	respond = async () => ok({ username: 'Player' })
	await session.initSkinSiteSession()
	assert.equal(storage.get(tokenKey), 'old-token')
	assert.equal(session.skinSiteStatus.value, 'error')
})

test('a failed sign-in attempt does not invalidate a pending startup renewal', async () => {
	storage.set(tokenKey, 'old-token')
	let finish!: (response: Response) => void
	respond = async (url) => {
		if (url.endsWith('/refresh'))
			return new Promise((resolve) => {
				finish = resolve
			})
		if (url.endsWith('/login'))
			return Response.json({ errorMessage: 'Invalid password' }, { status: 401 })
		return url.endsWith('/user') ? ok(user) : ok([])
	}
	const initializing = session.initSkinSiteSession()
	await new Promise((resolve) => setImmediate(resolve))
	await session.signInSkinSite({ username: 'Player', password: 'wrong', clientId: 'captcha' })
	finish(ok({ username: 'Player', jwt: 'fresh-token' }))
	await initializing
	assert.equal(session.skinSiteStatus.value, 'signed-in')
	assert.equal(storage.get(tokenKey), 'fresh-token')
})

test('rejection of an old startup token does not discard a new successful login', async () => {
	storage.set(tokenKey, 'expired-token')
	let finishRefresh!: (response: Response) => void
	let finishLogin!: (response: Response) => void
	respond = async (url) => {
		if (url.endsWith('/refresh'))
			return new Promise((resolve) => {
				finishRefresh = resolve
			})
		if (url.endsWith('/login'))
			return new Promise((resolve) => {
				finishLogin = resolve
			})
		return url.endsWith('/user') ? ok(user) : ok([])
	}
	const initializing = session.initSkinSiteSession()
	const signingIn = session.signInSkinSite({
		username: 'Player',
		password: 'valid',
		clientId: 'captcha',
	})
	await new Promise((resolve) => setImmediate(resolve))
	finishRefresh(Response.json({ errorMessage: 'Expired' }, { status: 401 }))
	await initializing
	finishLogin(ok({ username: 'Player', jwt: 'login-token' }))
	await signingIn
	assert.equal(session.skinSiteStatus.value, 'signed-in')
	assert.equal(storage.get(tokenKey), 'login-token')
})

test('explicit sign-out discards a late successful login', async () => {
	let finishLogin!: (response: Response) => void
	respond = () =>
		new Promise((resolve) => {
			finishLogin = resolve
		})
	const signingIn = session.signInSkinSite({
		username: 'Player',
		password: 'valid',
		clientId: 'captcha',
	})
	await new Promise((resolve) => setImmediate(resolve))
	session.signOutSkinSite()
	finishLogin(ok({ username: 'Player', jwt: 'late-login-token' }))
	await signingIn
	assert.equal(session.skinSiteStatus.value, 'signed-out')
	assert.equal(storage.has(tokenKey), false)
})

test('player heads are cropped from one downloaded local texture rather than a cross-origin image', async (t) => {
	const textureUrl = 'https://skin.starlight.cool/yggdrasil/textures/test'
	const textureData = 'data:image/png;base64,iVBORw=='
	const previousReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
	Object.defineProperty(globalThis, 'FileReader', {
		configurable: true,
		value: class {
			result: string | null = null
			onload?: () => void
			readAsDataURL(blob: Blob) {
				void blob.arrayBuffer().then((bytes) => {
					this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
					this.onload?.()
				})
			}
		},
	})
	t.after(() => {
		if (previousReader) Object.defineProperty(globalThis, 'FileReader', previousReader)
		else Reflect.deleteProperty(globalThis, 'FileReader')
	})
	t.mock.method(globalThis, 'fetch', async () => {
		throw new TypeError('Cross-origin image request blocked')
	})
	testGlobal.skinSiteTestHead = async (source) => {
		if (source !== textureData) throw new Error('Cross-origin canvas image blocked')
		return 'data:image/png;base64,local-head'
	}
	respond = async (url) => {
		if (url === textureUrl)
			return new Response(new Uint8Array([137, 80, 78, 71]), {
				headers: { 'Content-Type': 'image/png' },
			})
		if (url.endsWith('/player/skin/player'))
			return ok({
				skin: textureUrl,
				cape: 'https://skin.starlight.cool/yggdrasil/textures/cape',
				model: 'slim',
			})
		if (url.endsWith('/player')) return ok([{ uuid: 'player', name: 'Player', isMojang: false }])
		return url.endsWith('/user') ? ok(user) : ok({ jwt: 'token' })
	}
	storage.set(tokenKey, 'old-token')
	await session.initSkinSiteSession()
	const [player] = await session.requestSkinSitePlayers()
	assert.equal(player.skinState, 'ready')
	assert.equal(player.skinDataUrl, textureData)
	assert.equal(player.headDataUrl, 'data:image/png;base64,local-head')
	assert.equal(player.model, 'slim')
	assert.equal(player.capeUrl, 'https://skin.starlight.cool/yggdrasil/textures/cape')
	assert.equal(calls.filter((call) => call.path === '/yggdrasil/textures/test').length, 1)
})
