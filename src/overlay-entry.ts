import { createHookRegistry, init } from './index'
import type { ClientConfigProjection } from './types'

declare const __herdwebConfig: ClientConfigProjection
declare const __herdwebVersion: string | undefined
const config = __herdwebConfig
const version = typeof __herdwebVersion !== 'undefined' ? __herdwebVersion : undefined
const hooks = createHookRegistry()
init(config, hooks, version)
