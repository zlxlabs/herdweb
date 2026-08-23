import { test as base, expect } from '@playwright/test'
import { startIsolatedServe } from './isolated-serve'

type ServeOptions = NonNullable<Parameters<typeof startIsolatedServe>[0]>
type IsolatedServe = Awaited<ReturnType<typeof startIsolatedServe>>

type Fixtures = {
	serveOptions: ServeOptions
	serve: IsolatedServe
}

export const test = base.extend<Fixtures>({
	serveOptions: [{}, { option: true }],
	serve: async ({ serveOptions }, use) => {
		const serve = await startIsolatedServe(serveOptions)
		try {
			await use(serve)
		} finally {
			await serve.close()
		}
	},
	baseURL: async ({ serve }, use) => {
		await use(serve.url)
	},
})

export { expect }
