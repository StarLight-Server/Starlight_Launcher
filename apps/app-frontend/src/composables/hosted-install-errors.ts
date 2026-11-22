import { shallowRef } from 'vue'

import {
	createHostedInstallErrorQueue,
	type HostedInstallFailure,
} from '../helpers/hosted-install-error-queue.ts'

export type { HostedInstallFailure } from '../helpers/hosted-install-error-queue.ts'

// Root-mounted presentation survives navigation away from the initiating page.
export const hostedInstallFailures = shallowRef<HostedInstallFailure[]>([])
const queue = createHostedInstallErrorQueue((failures) => {
	hostedInstallFailures.value = failures
})

export const reportHostedInstallFailure = queue.report
export const isHostedInstallErrorHandled = queue.handled
export const suppressHostedInstallFailure = queue.ignore
export const dismissHostedInstallFailure = queue.dismiss
export const clearHostedInstallFailures = queue.clear
