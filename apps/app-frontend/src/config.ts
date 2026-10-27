const trimTrailingSlash = (url: string) => url.replace(/\/$/, '')

export const AxolotlBrandConfig = Object.freeze({
	productName: 'Starlight Launcher',
	shortProductName: 'Starlight',
	website: 'https://skin.starlight.cool/',
	repositoryUrl: 'https://github.com/StarLight-Server/Starlight_Launcher',
	releasesUrl: 'https://github.com/StarLight-Server/Starlight_Launcher/releases',
	supportUrl: 'https://skin.starlight.cool/',
	qqGroupNumber: '000000000',
	qqChannelUrl: 'https://skin.starlight.cool/',
	sponsorUrl: 'https://skin.starlight.cool/',
	surveyUrl: 'https://skin.starlight.cool/',
	bundleIdentifier: 'cool.starlight.launcher',
	deepLinkScheme: 'starlight',
	userAgent: (version: string, os: string) => `garbage-human-studio/starlight/${version} (${os})`,
	capabilities: Object.freeze({
		publicModrinthApi: true,
		privateModrinthServices: false,
		ghsTelemetry: false,
	}),
})

const siteUrl = trimTrailingSlash(import.meta.env.MODRINTH_URL || 'https://modrinth.com')
const officialLabrinthBaseUrl = trimTrailingSlash(
	import.meta.env.MODRINTH_API_BASE_URL || 'https://api.modrinth.com',
)
type DownloadSourceMode = 'auto' | 'official_only' | 'mirror_preferred' | 'official_preferred'

// The Modrinth API always uses the official source; Modrinth download mirror
// routing is handled by the Rust download layer.
export function setModrinthSourceMode(_sourceMode: DownloadSourceMode) {}

export function setModrinthMirrorEnabled(_enabled: boolean) {}

export function getOfficialLabrinthBaseUrl() {
	return officialLabrinthBaseUrl
}

export function getLabrinthBaseUrl() {
	return officialLabrinthBaseUrl
}

export const config = {
	siteUrl,
	labrinthBaseUrl: getLabrinthBaseUrl,
}
