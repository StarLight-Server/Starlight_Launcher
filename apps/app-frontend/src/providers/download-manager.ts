import { createContext } from '@modrinth/ui'
import { computed, type ComputedRef, type Ref, ref } from 'vue'

import {
	forgetHostedCreation,
	markHostedCreationCompleted,
	markHostedCreationFailed,
} from '@/composables/useHostedCreation'
import { runHostedSync } from '@/composables/useHostedSync'
import { setCurseForgeManualDownloads } from '@/helpers/curseforge-manual'
import {
	download_request_listener,
	install_job_listener,
	instance_listener,
	loading_listener,
} from '@/helpers/events'
import { createHostedDownloadFailures } from '@/helpers/hosted-download-failures'
import { retryInstallJob } from '@/helpers/hosted-install-retry'
import { getInstanceMode, onHostedPackAttemptStarted } from '@/helpers/hosted-packs'
import {
	download_history_clear,
	download_job_cancel,
	download_job_delete,
	download_job_get,
	download_job_list,
	download_job_resume,
	download_job_retry,
	type DownloadRequestUpdate,
	install_job_skip_missing_content,
	installJobInstanceId,
	type InstallJobSnapshot,
} from '@/helpers/install'
import type { LoadingBar } from '@/helpers/state'
import { progress_bars_list } from '@/helpers/state'

const activeStatuses = new Set(['queued', 'running', 'canceling', 'waiting_for_user'])
export const downloadBarTypes = new Set([
	'hosted_mod_download',
	'hosted_pack_sync',
	'java_download',
	'pack_file_download',
	'pack_download',
	'minecraft_download',
	'instance_update',
	'launcher_update',
])

export interface DownloadManager {
	jobs: Ref<InstallJobSnapshot[]>
	legacyDownloads: Ref<LoadingBar[]>
	activeJobs: ComputedRef<InstallJobSnapshot[]>
	historyJobs: ComputedRef<InstallJobSnapshot[]>
	activeCount: ComputedRef<number>
	queuedCount: ComputedRef<number>
	start: () => Promise<void>
	refresh: () => Promise<void>
	cancel: (jobId: string) => Promise<void>
	retry: (jobId: string) => Promise<void>
	retryHosted: (instanceId: string, sourceJobId?: string) => Promise<void>
	resume: (jobId: string) => Promise<void>
	skipMissingContent: (jobId: string) => Promise<void>
	remove: (jobId: string) => Promise<void>
	clearHistory: () => Promise<void>
	/**
	 * Insert a synthetic job created on the frontend (e.g. a server download
	 * that does not go through the backend install-pipeline). The job is kept
	 * in-memory and will disappear on refresh — callers must update it via
	 * `setSyntheticJob` to keep it alive.
	 */
	addSyntheticJob: (job: InstallJobSnapshot) => void
	/**
	 * Replace a synthetic job (identified by `job_id`) with a fresh snapshot.
	 * This is a no-op for backend-tracked jobs.
	 */
	setSyntheticJob: (job: InstallJobSnapshot) => void
	/**
	 * Register a cancel handler for a synthetic job.  When `cancel()` is
	 * called with this jobId the handler is invoked *before* the job is
	 * removed from the list, allowing the caller to abort the underlying
	 * operation (e.g. stop a server install).
	 */
	onSyntheticCancel: (jobId: string, handler: () => void | Promise<void>) => void
	/**
	 * Unregister a previously registered cancel handler.
	 */
	offSyntheticCancel: (jobId: string) => void
	dispose: () => void
}

export function createDownloadManager(handleError: (error: unknown) => void): DownloadManager {
	const jobs = ref<InstallJobSnapshot[]>([])
	const legacyDownloads = ref<LoadingBar[]>([])
	const hostedFailures = createHostedDownloadFailures()
	let started = false
	let disposed = false
	let unlistenJobs: (() => void) | null = null
	let unlistenRequests: (() => void) | null = null
	let unlistenLoading: (() => void) | null = null
	let unlistenHostedAttempts: (() => void) | null = null
	let unlistenInstances: (() => void) | null = null
	let initializing = false
	const pendingInitialUpdates: Array<
		{ kind: 'job'; job: InstallJobSnapshot } | { kind: 'request'; update: DownloadRequestUpdate }
	> = []
	const pendingRequestUpdatesByJob = new Map<string, DownloadRequestUpdate[]>()
	const pendingRequestUpdates: DownloadRequestUpdate[] = []
	let requestFlushTimer: ReturnType<typeof setTimeout> | null = null
	let legacyRefreshTimer: ReturnType<typeof setTimeout> | null = null
	let legacyRefreshGeneration = 0

	function persistManualDownloadsFromJob(job: InstallJobSnapshot) {
		if (job.status !== 'waiting_for_user' && job.status !== 'succeeded') return
		const instanceId = installJobInstanceId(job)
		const hasManualDownloadHistory = job.items.some((item) => item.manual_url)
		if (!instanceId || !hasManualDownloadHistory) return
		const manualItems = job.items
			.filter(
				(item) =>
					item.status === 'skipped' && item.manual_url && item.project_id && item.version_id,
			)
			.map((item) => ({
				projectId: Number(item.project_id),
				fileId: Number(item.version_id),
				fileName: item.name,
				websiteUrl: item.manual_url ?? undefined,
			}))
		setCurseForgeManualDownloads(instanceId, manualItems)
	}

	function setJob(job: InstallJobSnapshot) {
		if (initializing) {
			pendingInitialUpdates.push({ kind: 'job', job })
			return
		}
		const current = jobs.value.find((candidate) => candidate.job_id === job.job_id)
		if (current && current.modified.localeCompare(job.modified) > 0) return
		const currentIndex = jobs.value.findIndex((candidate) => candidate.job_id === job.job_id)
		if (currentIndex !== -1) {
			// Progress snapshots are frequent. Keep an existing job in its current
			// position instead of rebuilding and sorting the whole list on every
			// update. Jobs created within the same second have identical timestamps;
			// sorting those snapshots repeatedly makes cards jump and can cause an
			// expanded details view to be patched onto a neighbouring card.
			const nextJobs = [...jobs.value]
			nextJobs[currentIndex] = job
			jobs.value = nextJobs
		} else {
			jobs.value = [job, ...jobs.value].sort((a, b) => b.created.localeCompare(a.created))
		}
		const pending = pendingRequestUpdatesByJob.get(job.job_id)
		if (pending) {
			pendingRequestUpdatesByJob.delete(job.job_id)
			for (const update of pending) updateRequest(update)
		}
		persistManualDownloadsFromJob(job)
	}

	function updateRequest(update: DownloadRequestUpdate) {
		if (initializing) {
			pendingInitialUpdates.push({ kind: 'request', update })
			return
		}
		pendingRequestUpdates.push(update)
		scheduleRequestFlush()
	}

	function scheduleRequestFlush() {
		if (requestFlushTimer !== null) return
		requestFlushTimer = setTimeout(() => {
			requestFlushTimer = null
			flushRequestUpdates()
		}, 120)
	}

	function flushRequestUpdates() {
		if (pendingRequestUpdates.length === 0) return
		const updates = pendingRequestUpdates.splice(0)
		let next = jobs.value
		for (const update of updates) {
			next = applyRequestUpdate(update, next)
		}
		jobs.value = next
	}

	function applyRequestUpdate(
		update: DownloadRequestUpdate,
		jobs: InstallJobSnapshot[],
	): InstallJobSnapshot[] {
		const jobIndex = jobs.findIndex((job) => job.job_id === update.job_id)
		if (jobIndex === -1) {
			const pending = pendingRequestUpdatesByJob.get(update.job_id) ?? []
			pending.push(update)
			pendingRequestUpdatesByJob.set(update.job_id, pending)
			return jobs
		}

		const job = jobs[jobIndex]
		const itemIndex = job.items.findIndex((item) => item.id === update.id)
		const current = itemIndex === -1 ? null : job.items[itemIndex]
		let item: InstallJobSnapshot['items'][number]

		switch (update.type) {
			case 'started':
				item = {
					...(current ?? {
						id: update.id,
						name: update.name,
						bytes_downloaded: 0,
					}),
					status: 'downloading',
					bytes_total: current?.bytes_total ?? update.bytes_total,
					attempt: update.attempt,
					max_attempts: update.max_attempts,
					error: null,
					request_url: update.url,
					source: update.source,
				}
				break
			case 'progress':
				if (!current) return jobs
				item = {
					...current,
					status: update.status,
					bytes_downloaded: update.bytes,
				}
				break
			case 'finished':
				if (!current) return jobs
				item = {
					...current,
					// A request has reached disk, but an install item may still be
					// hashing, registering metadata, or waiting for SQLite.
					status: 'verifying',
					bytes_downloaded: update.bytes,
					bytes_total: current.bytes_total ?? update.bytes,
				}
				break
			case 'failed':
				if (!current) return jobs
				item = { ...current, status: 'failed' }
				break
		}

		const items = [...job.items]
		if (itemIndex === -1) items.push(item)
		else items[itemIndex] = item
		const nextJobs = [...jobs]
		nextJobs[jobIndex] = {
			...job,
			items,
			summary:
				update.type === 'progress'
					? {
							...job.summary,
							speed_bytes_per_second: update.speed_bytes_per_second,
							eta_seconds: update.eta_seconds,
						}
					: job.summary,
		}
		return nextJobs
	}

	async function refresh() {
		const page = await download_job_list({ limit: 250 }).catch((error) => {
			handleError(error)
			return null
		})
		if (page && !disposed) {
			const activeSynthetics = jobs.value.filter(
				(job) => syntheticIds.has(job.job_id) && activeStatuses.has(job.status),
			)
			jobs.value = [...page.jobs, ...activeSynthetics].sort((a, b) =>
				b.created.localeCompare(a.created),
			)
			const seenInstances = new Set<string>()
			for (const job of page.jobs) {
				if (job.status !== 'succeeded') continue
				const instanceId = installJobInstanceId(job)
				if (!instanceId || seenInstances.has(instanceId)) continue
				seenInstances.add(instanceId)
				persistManualDownloadsFromJob(job)
			}
		}
	}

	async function refreshLegacyDownloads() {
		const generation = ++legacyRefreshGeneration
		const bars = await progress_bars_list().catch((error) => {
			handleError(error)
			return {}
		})
		if (disposed || generation !== legacyRefreshGeneration) return
		legacyDownloads.value = Object.values(bars)
			.filter((bar) => !hostedFailures.isRetired(String(bar.loading_bar_uuid)))
			.filter((bar) => downloadBarTypes.has(bar.bar_type?.type ?? ''))
			.filter(
				(bar) =>
					!(
						bar.bar_type?.type === 'hosted_pack_sync' &&
						hostedFailures.has(bar.bar_type.instance_id ?? '')
					),
			)
			.map((bar) => ({
				...bar,
				title:
					bar.title ??
					bar.bar_type?.file_name ??
					bar.bar_type?.pack_name ??
					bar.bar_type?.instance_name ??
					bar.message,
			}))
		legacyDownloads.value.push(...hostedFailures.values())
	}

	function scheduleLegacyRefresh() {
		if (legacyRefreshTimer !== null) return
		legacyRefreshTimer = setTimeout(() => {
			legacyRefreshTimer = null
			void refreshLegacyDownloads()
		}, 300)
	}

	function clearHostedAttempt(instanceId: string) {
		hostedFailures.begin(instanceId, legacyDownloads.value)
		legacyRefreshGeneration++
		legacyDownloads.value = legacyDownloads.value.filter(
			(bar) => !hostedFailures.isRetired(String(bar.loading_bar_uuid)),
		)
	}

	async function start() {
		if (started || disposed) return
		started = true
		unlistenHostedAttempts = onHostedPackAttemptStarted(clearHostedAttempt)
		unlistenInstances = await instance_listener((event: { event: string; instance_id: string }) => {
			if (event.event !== 'removed') return
			forgetHostedCreation(event.instance_id)
			clearHostedAttempt(event.instance_id)
		})
		initializing = true
		unlistenRequests = await download_request_listener((update: DownloadRequestUpdate) =>
			updateRequest(update),
		)
		unlistenJobs = await install_job_listener((job: InstallJobSnapshot) => setJob(job))
		unlistenLoading = await loading_listener(
			(payload: {
				fraction: number | null
				loader_uuid: string
				event: LoadingBar['bar_type']
			}) => {
				hostedFailures.update(payload)
				scheduleLegacyRefresh()
			},
		)
		await Promise.all([refresh(), refreshLegacyDownloads()])
		initializing = false
		for (const update of pendingInitialUpdates.splice(0)) {
			if (update.kind === 'job') setJob(update.job)
			else updateRequest(update.update)
		}
	}

	async function cancel(jobId: string) {
		if (syntheticIds.has(jobId)) {
			// Remove the ID *before* removing the job from the list so that any
			// in-flight progress listener callback that calls setSyntheticJob
			// will see the missing ID and become a no-op, preventing the job
			// from being re-inserted.
			syntheticIds.delete(jobId)
			const handler = syntheticCancelHandlers.get(jobId)
			if (handler) {
				try {
					await handler()
				} catch {
					// Handler errors are non-fatal; still remove the job from the list.
				}
			}
			jobs.value = jobs.value.filter((job) => job.job_id !== jobId)
			return
		}
		const job = await download_job_cancel(jobId)
		await reconcileJob(job)
	}

	async function retry(jobId: string) {
		const original =
			jobs.value.find((candidate) => candidate.job_id === jobId) ?? (await download_job_get(jobId))
		const job = await retryInstallJob(original, {
			getInstanceMode,
			retryHosted,
			retryGeneric: download_job_retry,
		})
		if (job) await reconcileJob(job)
	}

	async function retryHosted(instanceId: string, sourceJobId?: string) {
		try {
			await runHostedSync(instanceId, () => retryHosted(instanceId, sourceJobId))
		} catch (error) {
			markHostedCreationFailed(instanceId, error)
			throw error
		}
		markHostedCreationCompleted(instanceId)
		if (sourceJobId) {
			await download_job_delete(sourceJobId).catch(handleError)
			jobs.value = jobs.value.filter((job) => job.job_id !== sourceJobId)
		}
		await refresh()
	}

	async function resume(jobId: string) {
		const job = await download_job_resume(jobId)
		await reconcileJob(job)
	}

	async function skipMissingContent(jobId: string) {
		const job = await install_job_skip_missing_content(jobId)
		await reconcileJob(job)
	}

	/**
	 * The job may already have reached a terminal state (or been removed) by
	 * the time the retry/cancel command returns. Fetch the freshest snapshot so
	 * the UI never shows a stale queued/running spinner, and drop the row
	 * entirely when the job no longer exists.
	 */
	async function reconcileJob(job: InstallJobSnapshot) {
		const freshest = await download_job_get(job.job_id).catch(() => null)
		if (freshest) {
			setJob(freshest)
		} else {
			jobs.value = jobs.value.filter((candidate) => candidate.job_id !== job.job_id)
		}
	}

	async function remove(jobId: string) {
		await download_job_delete(jobId)
		jobs.value = jobs.value.filter((job) => job.job_id !== jobId)
	}

	async function clearHistory() {
		await download_history_clear()
		jobs.value = jobs.value.filter((job) => activeStatuses.has(job.status))
	}

	const activeJobs = computed(() => jobs.value.filter((job) => activeStatuses.has(job.status)))
	const historyJobs = computed(() => jobs.value.filter((job) => !activeStatuses.has(job.status)))

	const syntheticIds = new Set<string>()
	const syntheticCancelHandlers = new Map<string, () => void | Promise<void>>()

	function addSyntheticJob(job: InstallJobSnapshot) {
		syntheticIds.add(job.job_id)
		// A server can be installed again after a previous synthetic record has
		// moved to history. Replace that record instead of creating duplicate
		// job IDs, which would make keyed download cards share a details view.
		jobs.value = [job, ...jobs.value.filter((candidate) => candidate.job_id !== job.job_id)].sort(
			(a, b) => b.created.localeCompare(a.created),
		)
	}

	function setSyntheticJob(job: InstallJobSnapshot) {
		if (!syntheticIds.has(job.job_id)) return
		setJob(job)
	}

	function onSyntheticCancel(jobId: string, handler: () => void | Promise<void>) {
		syntheticCancelHandlers.set(jobId, handler)
	}

	function offSyntheticCancel(jobId: string) {
		syntheticCancelHandlers.delete(jobId)
	}

	return {
		jobs,
		legacyDownloads,
		activeJobs,
		historyJobs,
		activeCount: computed(
			() =>
				activeJobs.value.length +
				legacyDownloads.value.filter((bar) => !bar.bar_type?.error).length,
		),
		queuedCount: computed(() => jobs.value.filter((job) => job.status === 'queued').length),
		start,
		refresh,
		cancel,
		retry,
		retryHosted,
		resume,
		skipMissingContent,
		remove,
		clearHistory,
		addSyntheticJob,
		setSyntheticJob,
		onSyntheticCancel,
		offSyntheticCancel,
		dispose() {
			disposed = true
			initializing = false
			pendingInitialUpdates.length = 0
			pendingRequestUpdatesByJob.clear()
			syntheticCancelHandlers.clear()
			if (requestFlushTimer !== null) {
				clearTimeout(requestFlushTimer)
				requestFlushTimer = null
			}
			if (legacyRefreshTimer !== null) {
				clearTimeout(legacyRefreshTimer)
				legacyRefreshTimer = null
			}
			pendingRequestUpdates.length = 0
			unlistenJobs?.()
			unlistenRequests?.()
			unlistenLoading?.()
			unlistenHostedAttempts?.()
			unlistenInstances?.()
		},
	}
}

export const [injectDownloadManager, provideDownloadManager] = createContext<DownloadManager>(
	'root',
	'downloadManager',
)
