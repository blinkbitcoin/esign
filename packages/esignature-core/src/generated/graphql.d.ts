/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends {
    [key: string]: unknown;
}> = {
    [K in keyof T]: T[K];
};
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | {
    [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never;
};
export type CreateEnvelopeInput = {
    contractType: string;
    recipient: RecipientInput;
};
export type GetSigningUrlInput = {
    envelopeId: string;
    recipient: RecipientInput;
};
export type RecipientInput = {
    email: string;
    name: string;
};
export type CreateEnvelopeMutationVariables = Exact<{
    input: CreateEnvelopeInput;
}>;
export type CreateEnvelopeMutation = {
    createEnvelope: {
        envelopeId: string;
        signingUrl: string;
    };
};
export type GetSigningUrlMutationVariables = Exact<{
    input: GetSigningUrlInput;
}>;
export type GetSigningUrlMutation = {
    getSigningUrl: {
        signingUrl: string;
    };
};
export {};
//# sourceMappingURL=graphql.d.ts.map