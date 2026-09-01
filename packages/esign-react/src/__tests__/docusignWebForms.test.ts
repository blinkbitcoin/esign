import {
  createDocuSignWebFormsSource,
  isMountable,
  type DocuSignSigning,
  type DocuSignSdk,
} from '../docusignWebForms';
import { createPublicUrlSource } from '@blinkbitcoin/esignature-core';

// A fake DocuSign.js SDK so the wiring (load → signing → on → mount) is tested
// without the real bundle.js.
const makeFakeSdk = () => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  const signing: DocuSignSigning = {
    on: (event, handler) => {
      handlers[event] = handler;
    },
    mount: jest.fn(),
    close: jest.fn(),
  };
  const sdk: DocuSignSdk = { signing: jest.fn(() => signing) };
  return { sdk, signing, handlers };
};

const makeSource = (over: Record<string, unknown> = {}) => {
  const { sdk, signing, handlers } = makeFakeSdk();
  const source = createDocuSignWebFormsSource({
    createInstance: jest
      .fn()
      .mockResolvedValue({ url: 'https://wf/1', envelopeId: 'inst-1' }),
    integrationKey: 'ik',
    loadDocuSign: jest.fn().mockResolvedValue(sdk),
    ...over,
  });
  return { source, sdk, signing, handlers };
};

describe('isMountable', () => {
  it('is true for a DocuSign.js source, false otherwise', () => {
    const { source } = makeSource();
    expect(isMountable(source)).toBe(true);
    expect(isMountable(createPublicUrlSource({ url: 'https://x' }))).toBe(
      false,
    );
    expect(isMountable(null)).toBe(false);
  });
});

describe('createDocuSignWebFormsSource', () => {
  it('start() mints an instance and returns the session', async () => {
    const { source } = makeSource();
    await expect(source.start()).resolves.toEqual({
      url: 'https://wf/1',
      envelopeId: 'inst-1',
    });
  });

  it('start() wraps a failing createInstance as a coded error', async () => {
    const { source } = makeSource({
      createInstance: jest.fn().mockRejectedValue(new Error('http 500')),
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
    });
  });

  it('mount() loads the SDK, wires sessionEnd, and forwards normalized events', async () => {
    const { source, sdk, signing, handlers } = makeSource();
    await source.start();
    const onEvent = jest.fn();
    const container = document.createElement('div');

    const cleanup = await source.mount(container, onEvent);

    expect(sdk.signing).toHaveBeenCalledWith({
      url: 'https://wf/1',
      displayFormat: 'focused',
    });
    expect(signing.mount).toHaveBeenCalledWith(container);

    // Real DocuSign.js sessionEnd → normalized complete
    handlers.sessionEnd({ event: 'sessionEnd', type: 'signingResult' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'complete',
      envelopeId: undefined,
    });

    // A non-terminal sessionEnd payload is ignored
    handlers.sessionEnd({ type: 'ready' });
    expect(onEvent).toHaveBeenCalledTimes(1);

    cleanup();
    expect(signing.close).toHaveBeenCalled();
  });

  it('honors a custom displayFormat', async () => {
    const { source, sdk } = makeSource({ displayFormat: 'default' });
    await source.start();
    await source.mount(document.createElement('div'), jest.fn());
    expect(sdk.signing).toHaveBeenCalledWith({
      url: 'https://wf/1',
      displayFormat: 'default',
    });
  });

  it('interpret uses the DocuSign event interpreter', () => {
    const { source } = makeSource();
    expect(
      source.interpret({ event: 'sessionEnd', type: 'signingResult' }),
    ).toMatchObject({
      type: 'complete',
    });
  });

  it('start() handles a non-Error rejection (no message)', async () => {
    const { source } = makeSource({
      createInstance: jest.fn().mockRejectedValue('nope'),
    });
    await expect(source.start()).rejects.toEqual({
      code: 'ENVELOPE_CREATION_FAILED',
      message: undefined,
    });
  });

  it('start() tolerates an instance with no envelopeId', async () => {
    const { source } = makeSource({
      createInstance: jest.fn().mockResolvedValue({ url: 'https://wf/2' }),
    });
    await expect(source.start()).resolves.toEqual({
      url: 'https://wf/2',
      envelopeId: undefined,
    });
  });

  it('mount() before start uses an empty url (defensive)', async () => {
    const { source, sdk } = makeSource();
    await source.mount(document.createElement('div'), jest.fn());
    expect(sdk.signing).toHaveBeenCalledWith({
      url: '',
      displayFormat: 'focused',
    });
  });
});
