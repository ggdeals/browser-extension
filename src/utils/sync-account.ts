import { EXTENSION_VERSION } from './sync-constants';
import { requestUserIdConsentViaPageSwal, toErrorMessage } from './sync-helpers';

type SyncAccount = {
    accountId: string;
    username: string;
};

type AccountSyncOptions = {
    serviceName: string;
    account: SyncAccount;
    accountLabel: string;
    configuredUsername: string;
    configuredAccountId?: string;
    connectUrl: string | null;
    postData: (url: string, payload: unknown) => Promise<void>;
};

// Each sync uses the same account matching, consent and reconnect rules
export function createAccountSync({
    serviceName,
    account,
    accountLabel,
    configuredUsername,
    configuredAccountId = '',
    connectUrl,
    postData
}: AccountSyncOptions) {
    const hasConfiguredAccount = Boolean(configuredAccountId || configuredUsername);
    const hasMatchingAccount = configuredAccountId
        ? configuredAccountId === account.accountId
        : Boolean(configuredUsername) && configuredUsername === account.username;
    let didConfirmAccount = false;
    let didConnectAccount = false;

    async function ensureSyncConsent(): Promise<void> {
        if (didConfirmAccount) {
            return;
        }
        if (!await requestUserIdConsentViaPageSwal(serviceName, accountLabel)) {
            throw new Error('Sync canceled: account not confirmed');
        }
        didConfirmAccount = true;
    }

    async function confirmAccountBeforeLibraryFetch(): Promise<void> {
        if (!hasMatchingAccount) {
            await ensureSyncConsent();
            if (!connectUrl) {
                throw new Error('Missing connect URL');
            }
        }
    }

    async function postAccount(data?: unknown, overwrite = hasConfiguredAccount): Promise<void> {
        if (!connectUrl) {
            throw new Error('Missing connect URL');
        }
        await postData(connectUrl, {
            version: EXTENSION_VERSION,
            accountId: account.accountId,
            username: account.username,
            ...(typeof data !== 'undefined' ? { data } : {}),
            ...(overwrite ? { overwrite: true } : {})
        });
        didConnectAccount = true;
    }

    async function connectAccount(data?: unknown): Promise<void> {
        if (!hasMatchingAccount && !didConnectAccount) {
            await ensureSyncConsent();
            await postAccount(data);
        }
    }

    async function postImportWithAccountMismatchRecovery(importUrl: string, payload: unknown): Promise<void> {
        try {
            await postData(importUrl, payload);
        } catch (error) {
            if (didConnectAccount || !hasConfiguredAccount || !toErrorMessage(error).includes('Invalid accountId:')) {
                throw error;
            }
            await ensureSyncConsent();
            await postAccount(undefined, true);
            await postData(importUrl, payload);
        }
    }

    return { confirmAccountBeforeLibraryFetch, connectAccount, postImportWithAccountMismatchRecovery };
}
