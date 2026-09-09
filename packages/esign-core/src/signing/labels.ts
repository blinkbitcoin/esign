// Copy resolution for the default signing UI, once for both platforms: the
// platform's defaults, then `label` for the title and the sign button, then
// any explicit overrides (null/undefined keep the default).

/** Copy overrides for the default ESignature UI (the platform may add keys). */
export interface ESignatureLabels {
  /** Idle-screen title (defaults to `label`). */
  title?: string;
  /** Idle-screen subtitle. */
  subtitle?: string;
  /** Primary sign button (defaults to `label`). */
  sign?: string;
  cancel?: string;
  loading?: string;
  signingTitle?: string;
  signingSubtitle?: string;
  success?: string;
  errorTitle?: string;
  /** Shown when an error carries no message. */
  errorFallback?: string;
  retry?: string;
  restart?: string;
  offline?: string;
  checkConnection?: string;
}

/** The defaults a platform supplies: every label but the two `label` fills. */
export type LabelDefaults<L extends ESignatureLabels> = Required<
  Omit<L, 'title' | 'sign'>
>;

export const resolveLabelsWith = <L extends ESignatureLabels>(
  defaults: LabelDefaults<L>,
  label: string,
  labels?: L,
): Required<L> => {
  const resolved = { ...defaults, title: label, sign: label } as Required<L>;
  for (const key of Object.keys(labels ?? {}) as (keyof L)[]) {
    const value = labels?.[key];
    if (value != null) {
      resolved[key] = value as Required<L>[keyof L];
    }
  }
  return resolved;
};
