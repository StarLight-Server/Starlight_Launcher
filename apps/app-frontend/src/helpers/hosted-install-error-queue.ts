import {
	classifyHostedInstallError,
	hostedErrorMessage,
	type HostedInstallErrorKind,
} from './hosted-install-errors.ts'

export interface HostedInstallFailureContext {
	instanceId?: string
	retry?: () => Promise<unknown>
}

export interface HostedInstallFailure extends HostedInstallFailureContext {
	id: number
	kind: HostedInstallErrorKind
	details: string
}

/** Reports operation results, never individual file attempts or progress events. */
export function createHostedInstallErrorQueue(
	onChange: (failures: HostedInstallFailure[]) => void = () => {},
) {
	let failures: HostedInstallFailure[] = []
	let sequence = 0
	const reported = new WeakSet<Error>()
	const handled = (cause: unknown): cause is Error => cause instanceof Error && reported.has(cause)
	function update(next: HostedInstallFailure[]) {
		failures = next
		onChange([...next])
	}
	function ignore(cause: unknown): Error {
		if (handled(cause)) return cause
		const error = new Error(hostedErrorMessage(cause))
		reported.add(error)
		return error
	}
	function report(cause: unknown, context: HostedInstallFailureContext = {}): Error {
		if (handled(cause)) return cause
		const details = hostedErrorMessage(cause)
		const error = ignore(cause)
		const kind = classifyHostedInstallError(cause)
		// Canceled operations must also be recognizable by outer notification handlers.
		if (kind === null) return error
		const retry = context.retry
		update([
			...failures,
			{
				id: ++sequence,
				kind,
				details,
				instanceId: context.instanceId,
				retry: retry
					? async () => {
							try {
								return await retry()
							} catch (cause) {
								throw report(cause, context)
							}
						}
					: undefined,
			},
		])
		return error
	}
	return {
		report,
		ignore,
		handled,
		values: () => [...failures],
		dismiss: (id: number) => update(failures.filter((failure) => failure.id !== id)),
		clear: (instanceId: string) =>
			update(failures.filter((failure) => failure.instanceId !== instanceId)),
	}
}
