import { invoke } from '@tauri-apps/api/core'

import type { InstallJobSnapshot } from './install'
import type {
	VersionChangeConfirmation,
	VersionChangePreview,
	VersionEnvironment,
} from './version-change-consent'

export function previewVersionChange(instanceId: string, target: VersionEnvironment | null = null) {
	return invoke<VersionChangePreview>('plugin:instance|instance_preview_version_change', {
		instanceId,
		target,
	})
}

export function changeInstanceVersion(
	instanceId: string,
	target: VersionEnvironment,
	confirmation: VersionChangeConfirmation,
) {
	return invoke<InstallJobSnapshot>('plugin:instance|instance_change_version', {
		instanceId,
		target,
		confirmation,
	})
}
