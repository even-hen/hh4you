import { APIRequestContext } from '@playwright/test'

export abstract class BaseApiClient {
    constructor(protected request: APIRequestContext) { }
}
