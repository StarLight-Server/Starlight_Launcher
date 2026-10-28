<script setup lang="ts">
import type { Labrinth } from '@modrinth/api-client'
import {
	Admonition,
	ButtonStyled,
	commonMessages,
	defineMessages,
	formatLoaderLabel,
	injectFilePicker,
	injectNotificationManager,
	InstallationSettingsLayout,
	instanceInstallablePlatforms,
	type LoaderMetadataStatus,
	loaderSupportState,
	loaderVersionsForGameVersion,
	provideAppBackup,
	provideInstallationSettings,
	scopedLoaderMetadataQueryKey,
	useDebugLogger,
	useVIntl,
} from '@modrinth/ui'
import type { GameVersionTag } from '@modrinth/utils'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import VersionChangeConfirmation from '@/components/instance/VersionChangeConfirmation.vue'
import SymlinkInstanceWarning from '@/components/ui/SymlinkInstanceWarning.vue'
import { useInstanceVersionEnvironment } from '@/composables/useInstanceVersionEnvironment'
import { get_project_versions, get_version } from '@/helpers/cache'
import { type CurseForgeFile, updateManagedCurseForgeModpack } from '@/helpers/curseforge'
import {
	install_duplicate_instance,
	install_existing_instance,
	install_pack_to_existing_instance,
	installJobInstanceId,
	wait_for_install_job,
} from '@/helpers/install'
import {
	edit,
	get_linked_modpack_info,
	list,
	update_managed_modrinth_version,
	update_repair_modrinth,
} from '@/helpers/instance'
import { get_loader_versions } from '@/helpers/metadata'
import { get_game_versions } from '@/helpers/tags'
import { changeInstanceVersion, previewVersionChange } from '@/helpers/version-change'
import {
	hasVersionChangeConsent,
	resetVersionChangeConsent,
} from '@/helpers/version-change-consent'
import { versionChangeMessages } from '@/helpers/version-change-messages'
import { injectInstanceSettings } from '@/providers/instance-settings'
import { useTheming } from '@/store/state'

import type { InstanceLoader, Manifest } from '../../../helpers/types'

const { handleError } = injectNotificationManager()
const filePicker = injectFilePicker()
const { formatMessage } = useVIntl()
const queryClient = useQueryClient()
const debug = useDebugLogger('AppInstallationSettings')
const themeStore = useTheming()

const { instance, offline, isMinecraftServer, onUnlinked, closeModal } = injectInstanceSettings()
const { query: environmentQuery, environment: currentEnvironment } =
	useInstanceVersionEnvironment(instance)
const versionConfirmation = ref<InstanceType<typeof VersionChangeConfirmation>>()
const changingVersion = ref(false)
const consentRevision = ref(0)
const consentStorage = {
	getItem: (key: string) => window.localStorage.getItem(key),
	setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
}
const hasSavedConsent = computed(() => {
	void consentRevision.value
	return hasVersionChangeConsent(instance.value.id, consentStorage)
})
function resetSavedConsent() {
	if (!resetVersionChangeConsent(instance.value.id, consentStorage)) {
		handleError(new Error(formatMessage(versionChangeMessages.resetFailed)))
	}
	consentRevision.value++
}
const skipNonEssentialWarnings = computed(() =>
	themeStore.getFeatureFlag('skip_non_essential_warnings'),
)

debug('metadata load: start', {
	instanceId: instance.value.id,
	loader: instance.value.loader,
	gameVersion: instance.value.game_version,
	installStage: instance.value.install_stage,
})

const gameVersionsQuery = useQuery({
	queryKey: ['instance-settings', 'game-versions'],
	queryFn: () => get_game_versions() as Promise<GameVersionTag[]>,
})

const editingPlatform = ref(instance.value.loader)
const editingGameVersion = ref(instance.value.game_version)
const scopedLoader = computed(() =>
	editingPlatform.value === 'neoforge' ? 'neo' : editingPlatform.value,
)
const scopedLoaderQueryEnabled = computed(
	() => editingPlatform.value !== 'vanilla' && !!editingGameVersion.value,
)
const scopedLoaderVersionsQuery = useQuery({
	queryKey: computed(() =>
		scopedLoaderMetadataQueryKey('instance-settings', scopedLoader.value, editingGameVersion.value),
	),
	queryFn: ({ queryKey }) => get_loader_versions(queryKey[2], queryKey[3]) as Promise<Manifest>,
	enabled: scopedLoaderQueryEnabled,
})
const scopedLoaderMetadataStatus = computed<LoaderMetadataStatus>(() => {
	if (!scopedLoaderQueryEnabled.value) return 'unknown'
	if (scopedLoaderVersionsQuery.isPending.value || scopedLoaderVersionsQuery.isFetching.value) {
		return 'loading'
	}
	if (scopedLoaderVersionsQuery.isError.value) return 'error'
	return 'success'
})
const scopedLoaderVersionState = computed(() =>
	loaderSupportState(
		scopedLoaderMetadataStatus.value,
		scopedLoaderVersionsQuery.data.value,
		editingGameVersion.value,
	),
)
const metadataLoading = computed(() => gameVersionsQuery.isLoading.value)

debug('metadata queries configured', {
	instanceId: instance.value.id,
	loader: instance.value.loader,
	gameVersion: instance.value.game_version,
})

const isModrinthLinkedModpack = computed(
	() =>
		instance.value.link?.type === 'modrinth_modpack' ||
		instance.value.link?.type === 'server_project_modpack',
)
const isCurseForgeLinkedModpack = computed(() => instance.value.link?.type === 'curseforge_modpack')
const isLinkedManagedModpack = computed(
	() => isModrinthLinkedModpack.value || isCurseForgeLinkedModpack.value,
)
const isImportedModpack = computed(() => instance.value.link?.type === 'imported_modpack')

const modpackInfoQuery = useQuery({
	queryKey: computed(() => ['linkedModpackInfo', instance.value.id]),
	queryFn: () => get_linked_modpack_info(instance.value.id, 'must_revalidate'),
	enabled: computed(
		() => instance.value.install_stage === 'installed' && isLinkedManagedModpack.value && !offline,
	),
})
const modpackInfo = modpackInfoQuery.data

const repairing = ref(false)
const reinstalling = ref(false)

const messages = defineMessages({
	loaderVersion: {
		id: 'instance.settings.tabs.installation.loader-version',
		defaultMessage: '{loader} version',
	},
})

async function installLocalModpackFromPicker() {
	const picked = await filePicker.pickModpackFile({ readFile: false })
	if (!picked?.path) return false

	const job = await install_pack_to_existing_instance(instance.value.id, {
		type: 'fromFile',
		path: picked.path,
	}).catch(handleError)
	if (!job) return false

	const completed = await wait_for_install_job(job.job_id).catch(handleError)
	return !!completed
}

provideAppBackup({
	async createBackup() {
		debug('createBackup: start', {
			instanceId: instance.value.id,
			instanceName: instance.value.name,
		})
		const allInstances = await list()
		const prefix = `${instance.value.name} - Backup #`
		const existingNums = allInstances
			.filter((p) => p.name.startsWith(prefix))
			.map((p) => parseInt(p.name.slice(prefix.length), 10))
			.filter((n) => !isNaN(n))
		const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1
		const job = await install_duplicate_instance(instance.value.id)
		const newInstanceId = installJobInstanceId(job)
		if (newInstanceId) {
			await edit(newInstanceId, { name: `${prefix}${nextNum}` })
		}
		debug('createBackup: done', { newInstanceId, backupName: `${prefix}${nextNum}` })
	},
})

provideInstallationSettings({
	closeSettings: closeModal,
	loading: computed(
		() =>
			metadataLoading.value || modpackInfoQuery.isLoading.value || environmentQuery.isPending.value,
	),
	installationInfo: computed(() => {
		const rows = [
			{
				label: formatMessage(commonMessages.platformLabel),
				value: formatLoaderLabel(currentEnvironment.value.modLoader),
			},
			{
				label: formatMessage(commonMessages.gameVersionLabel),
				value: currentEnvironment.value.gameVersion,
			},
		]
		if ((instance.value.loader_components ?? []).length > 1) {
			for (const component of instance.value.loader_components ?? []) {
				rows.push({
					label: formatMessage(messages.loaderVersion, {
						loader: formatLoaderLabel(component.kind),
					}),
					value: component.version ?? formatLoaderLabel(component.kind),
				})
			}
		} else if (
			currentEnvironment.value.modLoader !== 'vanilla' &&
			currentEnvironment.value.modLoaderVersion
		) {
			rows.push({
				label: formatMessage(messages.loaderVersion, {
					loader: formatLoaderLabel(currentEnvironment.value.modLoader),
				}),
				value: currentEnvironment.value.modLoaderVersion,
			})
		}
		return rows
	}),
	isLinked: computed(() => isLinkedManagedModpack.value || isImportedModpack.value),
	isBusy: computed(
		() =>
			instance.value.install_stage !== 'installed' ||
			repairing.value ||
			reinstalling.value ||
			changingVersion.value ||
			!environmentQuery.isSuccess.value ||
			!!offline,
	),
	skipNonEssentialWarnings,
	modpack: computed(() => {
		if (isImportedModpack.value && instance.value.link?.type === 'imported_modpack') {
			return {
				iconUrl: instance.value.icon_path,
				title: instance.value.link.name ?? instance.value.name,
				versionNumber: instance.value.link.version_number ?? undefined,
				filename: instance.value.link.filename ?? undefined,
			}
		}
		if (modpackInfo.value) {
			return {
				iconUrl: modpackInfo.value.project.icon_url,
				title: modpackInfo.value.project.title,
				link: isCurseForgeLinkedModpack.value
					? `/project/curseforge/${String(modpackInfo.value.project.id).replace(/^curseforge:/, '')}`
					: `/project/${modpackInfo.value.project.slug ?? modpackInfo.value.project.id}`,
				versionNumber: modpackInfo.value.version?.version_number,
			}
		}
		// Fallback when linked metadata is temporarily unavailable so the
		// association controls still match Modrinth-linked packs.
		if (isCurseForgeLinkedModpack.value && instance.value.link?.type === 'curseforge_modpack') {
			return {
				iconUrl: instance.value.icon_path,
				title: instance.value.name,
				link: `/project/curseforge/${instance.value.link.project_id}`,
				versionNumber: instance.value.link.version_id,
			}
		}
		if (isModrinthLinkedModpack.value && instance.value.link) {
			const projectId =
				instance.value.link.type === 'server_project_modpack'
					? (instance.value.link.content_project_id ?? instance.value.link.project_id)
					: instance.value.link.project_id
			const versionId =
				instance.value.link.type === 'server_project_modpack'
					? instance.value.link.content_version_id
					: instance.value.link.version_id
			if (!projectId) return null
			return {
				iconUrl: instance.value.icon_path,
				title: instance.value.name,
				link: `/project/${projectId}`,
				versionNumber: versionId ?? undefined,
			}
		}
		return null
	}),
	currentPlatform: computed(() => currentEnvironment.value.modLoader),
	currentGameVersion: computed(() => currentEnvironment.value.gameVersion),
	currentLoaderVersion: computed(() => currentEnvironment.value.modLoaderVersion ?? ''),
	availablePlatforms: computed(() => [...instanceInstallablePlatforms]),
	editingPlatformRef: editingPlatform,
	editingGameVersionRef: editingGameVersion,
	loaderVersionState: scopedLoaderVersionState,

	resolveGameVersions(loader, showSnapshots) {
		const versions = gameVersionsQuery.data.value ?? []
		const result = (
			showSnapshots ? versions : versions.filter((x) => x.version_type === 'release')
		).map((x) => ({ value: x.version, label: x.version }))
		debug('resolveGameVersions:', {
			loader,
			showSnapshots,
			totalVersions: versions.length,
			resultVersions: result.length,
		})
		return result
	},

	resolveLoaderVersions(loader, gameVersion) {
		if (loader === 'vanilla' || !gameVersion) {
			debug('resolveLoaderVersions: skipped', { loader, gameVersion })
			return []
		}
		if (loader !== editingPlatform.value || gameVersion !== editingGameVersion.value) {
			debug('resolveLoaderVersions: stale selection', { loader, gameVersion })
			return []
		}
		if (scopedLoaderVersionState.value !== 'supported') return []
		const result = loaderVersionsForGameVersion(scopedLoaderVersionsQuery.data.value, gameVersion)
		debug('resolveLoaderVersions: result', { loader, gameVersion, count: result.length })
		return result
	},

	resolveHasSnapshots(loader) {
		const versions = gameVersionsQuery.data.value ?? []
		const result = versions.some((x) => x.version_type !== 'release')
		debug('resolveHasSnapshots:', {
			loader,
			totalVersions: versions.length,
			result,
		})
		return result
	},

	async save(platform: string, gameVersion: string, loaderVersionId: string | null) {
		const sourceInstance = { ...instance.value }
		changingVersion.value = true
		try {
			const preview = await previewVersionChange(sourceInstance.id, {
				gameVersion,
				modLoader: platform as InstanceLoader,
				modLoaderVersion: loaderVersionId,
			}).catch((error) => {
				handleError(error)
				throw error
			})
			const confirmation = await versionConfirmation.value?.confirm(sourceInstance, preview)
			if (!confirmation || instance.value.id !== sourceInstance.id) {
				throw new Error('Version change canceled')
			}
			try {
				const job = await changeInstanceVersion(sourceInstance.id, preview.target, confirmation)
				await wait_for_install_job(job.job_id)
				await environmentQuery.refetch()
			} catch (error) {
				handleError(error)
				throw error
			}
		} finally {
			changingVersion.value = false
			consentRevision.value++
		}
	},

	async repair() {
		debug('repair: called', { instanceId: instance.value.id })
		repairing.value = true
		await install_existing_instance(instance.value.id, true).catch(handleError)
		repairing.value = false
		debug('repair: done')
	},

	async reinstallModpack() {
		debug('reinstallModpack: called', { instanceId: instance.value.id })
		reinstalling.value = true
		try {
			if (isImportedModpack.value) {
				await installLocalModpackFromPicker()
			} else if (isCurseForgeLinkedModpack.value) {
				const fileId = Number(instance.value.link?.version_id)
				if (!Number.isFinite(fileId)) {
					throw new Error('Invalid CurseForge file ID')
				}
				await updateManagedCurseForgeModpack(instance.value.id, fileId).catch(handleError)
			} else {
				await update_repair_modrinth(instance.value.id).catch(handleError)
			}
		} finally {
			reinstalling.value = false
		}
		debug('reinstallModpack: done')
	},

	async swapModpack() {
		debug('swapModpack: called', { instanceId: instance.value.id })
		reinstalling.value = true
		try {
			await installLocalModpackFromPicker()
		} finally {
			reinstalling.value = false
		}
		debug('swapModpack: done')
	},

	async unlinkModpack() {
		debug('unlinkModpack: called', { instanceId: instance.value.id })
		await edit(instance.value.id, {
			link: null as unknown as undefined,
		})
		await queryClient.invalidateQueries({
			queryKey: ['linkedModpackInfo', instance.value.id],
		})
		onUnlinked()
		debug('unlinkModpack: done')
	},

	getCachedModpackVersions: () => null,
	async fetchModpackVersions() {
		debug('fetchModpackVersions: called', {
			projectId: instance.value.link?.project_id,
		})
		if (isCurseForgeLinkedModpack.value) {
			const rawProjectId = instance.value.link?.project_id
			if (!rawProjectId) return []
			const projectId = Number(
				rawProjectId.startsWith('curseforge:')
					? rawProjectId.slice('curseforge:'.length)
					: rawProjectId,
			)
			if (!Number.isFinite(projectId)) return []
			const { getCurseForgeFile, getCurseForgeFiles } = await import('@/helpers/curseforge')
			const files: CurseForgeFile[] = []
			let index = 0
			while (true) {
				const response = await getCurseForgeFiles(projectId, {
					index,
					pageSize: 50,
				}).catch(handleError)
				if (!response) break
				files.push(...response.files)
				index += response.files.length
				if (
					response.files.length === 0 ||
					index >= (response.pagination?.totalCount ?? response.files.length)
				) {
					break
				}
			}
			const installedFileId = Number(instance.value.link?.version_id)
			if (Number.isFinite(installedFileId) && !files.some((file) => file.id === installedFileId)) {
				const installedFile = await getCurseForgeFile(projectId, installedFileId).catch(() => null)
				if (installedFile?.isAvailable) {
					files.push(installedFile)
				}
			}
			const versions = files
				.filter((file) => file.isAvailable)
				.map((file) => {
					const loaders = [
						...new Set(
							file.gameVersions
								.map((value) => {
									switch (value.toLowerCase().replaceAll(' ', '')) {
										case 'forge':
											return 'forge'
										case 'fabric':
										case 'fabricloader':
											return 'fabric'
										case 'quilt':
											return 'quilt'
										case 'neoforge':
											return 'neoforge'
										default:
											return null
									}
								})
								.filter(Boolean),
						),
					] as string[]
					const gameVersions = file.gameVersions.filter((value) => {
						const normalized = value.toLowerCase().replaceAll(' ', '')
						return !['forge', 'fabric', 'fabricloader', 'quilt', 'neoforge'].includes(normalized)
					})
					return {
						id: file.id.toString(),
						project_id: `curseforge:${projectId}`,
						name: file.displayName,
						version_number: file.displayName,
						game_versions: gameVersions,
						loaders: loaders.length > 0 ? loaders : ['minecraft'],
						date_published: file.fileDate,
						version_type:
							file.releaseType === 1 ? 'release' : file.releaseType === 2 ? 'beta' : 'alpha',
						files: [
							{
								filename: file.fileName,
								url: file.downloadUrl ?? '',
								primary: true,
								size: file.fileLength,
								hashes: {},
							},
						],
					} as unknown as Labrinth.Versions.v2.Version
				})
			debug('fetchModpackVersions: done', { count: versions.length })
			return versions
		}
		const versions = await get_project_versions(instance.value.link!.project_id!).catch(handleError)
		debug('fetchModpackVersions: done', { count: versions?.length ?? 0 })
		return (versions ?? []) as Labrinth.Versions.v2.Version[]
	},

	async getVersionChangelog(versionId: string) {
		debug('getVersionChangelog: called', { versionId })
		if (isCurseForgeLinkedModpack.value) {
			const rawProjectId = instance.value.link?.project_id
			const fileId = Number(versionId)
			const projectId = rawProjectId
				? Number(
						rawProjectId.startsWith('curseforge:')
							? rawProjectId.slice('curseforge:'.length)
							: rawProjectId,
					)
				: NaN
			if (!Number.isFinite(projectId) || !Number.isFinite(fileId)) return null
			const { getCurseForgeChangelog } = await import('@/helpers/curseforge')
			const changelog = await getCurseForgeChangelog(projectId, fileId).catch(() => null)
			if (changelog == null) return null
			return { id: versionId, changelog } as unknown as Labrinth.Versions.v2.Version
		}
		return (await get_version(versionId, 'must_revalidate').catch(
			() => null,
		)) as Labrinth.Versions.v2.Version | null
	},

	async onModpackVersionConfirm(version) {
		debug('onModpackVersionConfirm: called', {
			versionId: version.id,
			instanceId: instance.value.id,
		})
		try {
			if (isCurseForgeLinkedModpack.value) {
				const fileId = Number(version.id)
				if (!Number.isFinite(fileId)) {
					throw new Error('Invalid CurseForge file ID')
				}
				await updateManagedCurseForgeModpack(instance.value.id, fileId)
			} else {
				await update_managed_modrinth_version(instance.value.id, version.id)
			}
			await queryClient.invalidateQueries({
				queryKey: ['linkedModpackInfo', instance.value.id],
			})
		} catch (error) {
			handleError(error as Error)
		}
		debug('onModpackVersionConfirm: done')
	},

	updaterModalProps: computed(() => ({
		isApp: true,
		currentVersionId:
			modpackInfo.value?.update?.provider === 'modrinth'
				? modpackInfo.value.update.target_version_id
				: modpackInfo.value?.update?.provider === 'curseforge'
					? String(modpackInfo.value.update.target_file_id)
					: (instance.value.link?.version_id ?? ''),
		projectIconUrl: modpackInfo.value?.project?.icon_url,
		projectName: modpackInfo.value?.project?.title ?? 'Modpack',
		currentGameVersion: instance.value.game_version,
		currentLoader: instance.value.loader,
	})),

	isServer: false,
	isApp: true,
	symlinkTarget: computed(() => instance.value.symlink_target),
	showModpackVersionActions: computed(
		() => isLinkedManagedModpack.value && !isMinecraftServer.value,
	),
	isLocalFile: isImportedModpack,
	repairing,
	reinstalling,
})
</script>

<template>
	<VersionChangeConfirmation ref="versionConfirmation" />
	<Admonition
		v-if="environmentQuery.isError.value"
		type="critical"
		:header="formatMessage(versionChangeMessages.readError)"
	>
		<ButtonStyled
			><button type="button" @click="environmentQuery.refetch()">
				{{ formatMessage(versionChangeMessages.retry) }}
			</button></ButtonStyled
		>
	</Admonition>
	<SymlinkInstanceWarning
		v-if="instance?.symlink_target"
		:symlink-target="instance.symlink_target"
	/>
	<InstallationSettingsLayout />
	<ButtonStyled v-if="hasSavedConsent" class="mt-4">
		<button type="button" :disabled="changingVersion" @click="resetSavedConsent">
			{{ formatMessage(versionChangeMessages.reset) }}
		</button>
	</ButtonStyled>
</template>
