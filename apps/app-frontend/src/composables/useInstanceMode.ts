import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import { getInstanceMode, type InstanceMode, setInstanceMode } from '@/helpers/hosted-packs'

import { clearHostedInstallFailures, reportHostedInstallFailure } from './hosted-install-errors'

export const instanceModeKey = (instanceId: string) => ['instance-mode', instanceId] as const

export function useInstanceMode(instanceId: MaybeRefOrGetter<string>) {
	return useQuery({
		queryKey: computed(() => instanceModeKey(toValue(instanceId))),
		queryFn: () => getInstanceMode(toValue(instanceId)),
		enabled: computed(() => !!toValue(instanceId)),
		staleTime: 30_000,
	})
}

export function useSetInstanceMode() {
	const client = useQueryClient()
	const mutation = useMutation({
		mutationFn: async (options: { instanceId: string; mode: InstanceMode }): Promise<void> => {
			const { instanceId, mode } = options
			if (mode === 'starlight') clearHostedInstallFailures(instanceId)
			try {
				await setInstanceMode(instanceId, mode)
			} catch (error) {
				if (mode !== 'starlight') throw error
				throw reportHostedInstallFailure(error, {
					instanceId,
					retry: async () => {
						await mutation.mutateAsync(options)
					},
				})
			}
		},
		onMutate: ({ instanceId }) => client.cancelQueries({ queryKey: instanceModeKey(instanceId) }),
		onSuccess: (_, { instanceId, mode }) => client.setQueryData(instanceModeKey(instanceId), mode),
		onError: (_, { instanceId }) =>
			client.invalidateQueries({ queryKey: instanceModeKey(instanceId) }),
	})
	return mutation
}
