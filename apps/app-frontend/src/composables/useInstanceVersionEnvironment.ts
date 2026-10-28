import { useQuery } from '@tanstack/vue-query'
import { computed, type Ref } from 'vue'

import type { GameInstance } from '@/helpers/types'
import { previewVersionChange } from '@/helpers/version-change'

export function useInstanceVersionEnvironment(instance: Ref<GameInstance>) {
	const query = useQuery({
		queryKey: computed(() => ['instance-version-environment', instance.value.id]),
		queryFn: ({ queryKey }) => previewVersionChange(queryKey[1]),
	})
	const environment = computed(
		() =>
			query.data.value?.source ?? {
				gameVersion: instance.value.game_version,
				modLoader: instance.value.loader,
				modLoaderVersion: instance.value.loader_version ?? null,
			},
	)
	return { query, environment }
}
