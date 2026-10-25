import { BackendProvider } from './BackendProvider'

/**
 * The one and only provider — every provider/payment call goes through the
 * backend serverless functions, which hold the eSIM Go key. There is no
 * alternate provider in production.
 */
export const provider = new BackendProvider()

export type { EsimProvider } from './EsimProvider'
export { BackendProvider } from './BackendProvider'
