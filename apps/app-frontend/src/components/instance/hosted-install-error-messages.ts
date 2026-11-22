import { defineMessages } from '@modrinth/ui'

export const titles = defineMessages({
	login: { id: 'app.hosted-error.login.title', defaultMessage: 'StarLight sign-in required' },
	account: {
		id: 'app.hosted-error.account.title',
		defaultMessage: 'A Minecraft account is required',
	},
	access: {
		id: 'app.hosted-error.access.title',
		defaultMessage: 'The modpack service denied access',
	},
	network: { id: 'app.hosted-error.network.title', defaultMessage: 'StarLight download failed' },
	runtime: {
		id: 'app.hosted-error.runtime.title',
		defaultMessage: 'Game component installation failed',
	},
	storage: {
		id: 'app.hosted-error.storage.title',
		defaultMessage: 'Could not save the client files',
	},
	'disk-space': {
		id: 'app.hosted-error.disk-space.title',
		defaultMessage: 'Not enough disk space',
	},
	permission: {
		id: 'app.hosted-error.permission.title',
		defaultMessage: 'Cannot access the installation folder',
	},
	busy: {
		id: 'app.hosted-error.busy.title',
		defaultMessage: 'The instance or its files are in use',
	},
	integrity: { id: 'app.hosted-error.integrity.title', defaultMessage: 'File verification failed' },
	conflict: { id: 'app.hosted-error.conflict.title', defaultMessage: 'Client files conflict' },
	configuration: {
		id: 'app.hosted-error.configuration.title',
		defaultMessage: 'The server modpack is unavailable',
	},
	recovery: {
		id: 'app.hosted-error.recovery.title',
		defaultMessage: 'Installation recovery is incomplete',
	},
	'manual-download': {
		id: 'app.hosted-error.manual-download.title',
		defaultMessage: 'A mod needs a manual download',
	},
	unknown: {
		id: 'app.hosted-error.unknown.title',
		defaultMessage: 'StarLight installation could not finish',
	},
})

export const descriptions = defineMessages({
	login: {
		id: 'app.hosted-error.login.description',
		defaultMessage:
			'Sign in to StarLight again, then retry the download. Signing in will not start the game.',
	},
	account: {
		id: 'app.hosted-error.account.description',
		defaultMessage:
			'Sign in with a StarLight account that has a player, or add an official Minecraft account from the account panel, then retry.',
	},
	access: {
		id: 'app.hosted-error.access.description',
		defaultMessage:
			'The server refused the modpack request. This does not necessarily mean your sign-in expired. Copy the details and contact the server administrator.',
	},
	network: {
		id: 'app.hosted-error.network.description',
		defaultMessage:
			'The download could not finish. Check your connection and retry. If a file is unavailable, send the details to the server administrator.',
	},
	runtime: {
		id: 'app.hosted-error.runtime.description',
		defaultMessage:
			'Minecraft, Java, or the mod loader could not be installed. Check the download details for the failed component, then retry after resolving the cause.',
	},
	storage: {
		id: 'app.hosted-error.storage.description',
		defaultMessage:
			'The launcher could not write or replace installation files. Check the folder and file paths in the details, then retry after resolving the cause.',
	},
	'disk-space': {
		id: 'app.hosted-error.disk-space.description',
		defaultMessage:
			'Free up space on the drive containing the installation folder and download cache, then select Retry.',
	},
	permission: {
		id: 'app.hosted-error.permission.description',
		defaultMessage:
			'Check that the installation folder is writable and its files are not being used by another program. Resolve the access problem, then select Retry.',
	},
	busy: {
		id: 'app.hosted-error.busy.description',
		defaultMessage:
			'Close this instance of Minecraft or any program using its files, or wait for the active installation to finish, then select Retry.',
	},
	integrity: {
		id: 'app.hosted-error.integrity.description',
		defaultMessage:
			'A downloaded file does not match the expected content. Retry to download it again. If this keeps happening, send the details to the server administrator.',
	},
	conflict: {
		id: 'app.hosted-error.conflict.description',
		defaultMessage:
			'Existing files or mods conflict with the server modpack. Check the file names in the details and resolve the conflict before trying again.',
	},
	configuration: {
		id: 'app.hosted-error.configuration.description',
		defaultMessage:
			'The published modpack or its game and loader versions are unavailable or invalid. Copy the details and ask the server administrator to check the release.',
	},
	recovery: {
		id: 'app.hosted-error.recovery.description',
		defaultMessage:
			'Installation failed and the previous files could not be fully restored. Close the game and wait for any active installation to finish, then retry recovery before launching.',
	},
	'manual-download': {
		id: 'app.hosted-error.manual-download.description',
		defaultMessage:
			'A required mod does not allow automatic downloads. Check the download details and contact the server administrator for the file and installation instructions.',
	},
	unknown: {
		id: 'app.hosted-error.unknown.description',
		defaultMessage:
			'The installation stopped unexpectedly. Check the download details or copy the error when requesting help.',
	},
})

export const messages = defineMessages({
	details: { id: 'app.hosted-error.details', defaultMessage: 'Error details' },
	copy: { id: 'app.hosted-error.copy', defaultMessage: 'Copy details' },
	copied: { id: 'app.hosted-error.copied', defaultMessage: 'Copied' },
	copyFailed: {
		id: 'app.hosted-error.copy-failed',
		defaultMessage: 'Could not copy. Select and copy the error details manually.',
	},
	downloads: { id: 'app.hosted-error.downloads', defaultMessage: 'View downloads' },
	retry: { id: 'app.hosted-error.retry', defaultMessage: 'Retry' },
	signIn: { id: 'app.hosted-error.sign-in', defaultMessage: 'Sign in to StarLight' },
	signedIn: {
		id: 'app.hosted-error.signed-in',
		defaultMessage:
			'Signed in. You can now retry the download. The game will not start automatically.',
	},
})
