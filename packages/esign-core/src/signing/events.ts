// Deprecated path: the DocuSign interpreter moved to providers/docusign/events;
// the bridge interpreter lives in ./bridge. Kept so the old module path keeps
// resolving; carries no logic of its own.

import { interpretDocuSignEvent as canonicalInterpretDocuSignEvent } from '../providers/docusign/events';

export { interpretBridgeEvent, interpretProxyEvent } from './bridge';

/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign/events) */
export const interpretDocuSignEvent = canonicalInterpretDocuSignEvent;
