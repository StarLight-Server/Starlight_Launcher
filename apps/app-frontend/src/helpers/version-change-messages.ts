import { defineMessages } from '@modrinth/ui'

export const versionChangeMessages = defineMessages({
	reset: {
		id: 'instance.version-change.reset',
		defaultMessage: 'Show version change warnings again for this instance',
	},
	resetFailed: {
		id: 'instance.version-change.reset-failed',
		defaultMessage: 'Unable to reset saved permissions. Please try again.',
	},
	linkedTitle: {
		id: 'instance.version-change.linked-title',
		defaultMessage: 'Allow changes to this linked instance?',
	},
	linkedBody: {
		id: 'instance.version-change.linked-body',
		defaultMessage:
			'Starlight will modify the launch configuration and components of this linked instance. After these changes, the original launcher (such as PCL or HMCL) may no longer recognize or launch it correctly.',
	},
	downgradeTitle: {
		id: 'instance.version-change.downgrade-title',
		defaultMessage: 'Allow Mod Loader downgrade?',
	},
	downgradeBody: {
		id: 'instance.version-change.downgrade-body',
		defaultMessage:
			'Downgrading the Mod Loader may make mods incompatible, prevent the game from starting, or damage world saves when they are loaded. Back up your saves before continuing.',
	},
	unknownTitle: {
		id: 'instance.version-change.unknown-title',
		defaultMessage: 'Confirm Mod Loader compatibility risk',
	},
	unknownBody: {
		id: 'instance.version-change.unknown-body',
		defaultMessage:
			'The current and target Mod Loader versions could not be reliably compared. This change may be a downgrade and may cause incompatible mods, startup failure, or damaged world saves when loaded. Back up your saves before continuing.',
	},
	remember: {
		id: 'instance.version-change.remember',
		defaultMessage: 'Always allow this operation for this instance without asking again',
	},
	allow: { id: 'instance.version-change.allow', defaultMessage: 'I understand, allow this change' },
	unknownVersion: {
		id: 'instance.version-change.unknown-version',
		defaultMessage: 'Unknown version',
	},
	readError: {
		id: 'instance.version-change.read-error',
		defaultMessage:
			'Unable to read the current installation. Check that its files are accessible and try again.',
	},
	loading: { id: 'instance.version-change.loading', defaultMessage: 'Reading current version…' },
	retry: { id: 'instance.version-change.retry', defaultMessage: 'Retry' },
})
