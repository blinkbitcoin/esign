import { isRestartable } from '../../types';
import { createHostedFormPublicUrlSource } from '../publicUrlSource';

describe('createHostedFormPublicUrlSource', () => {
  it('is not restartable', () => {
    expect(
      isRestartable(createHostedFormPublicUrlSource({ url: 'https://form' })),
    ).toBe(false);
  });

  it('start() returns the static url with the allowed origin', async () => {
    const source = createHostedFormPublicUrlSource({
      url: 'https://form?x=1',
      allowedOrigin: 'https://forms.example',
    });
    await expect(source.start()).resolves.toEqual({
      url: 'https://form?x=1',
      allowedOrigin: 'https://forms.example',
    });
  });

  it('reads the bridge protocol by default', () => {
    const source = createHostedFormPublicUrlSource({ url: 'https://form' });
    expect(source.interpret({ event: 'cancel' })).toEqual({ type: 'cancel' });
    expect(source.interpret({ type: 'cancel' })).toBeNull();
  });

  it('uses the injected interpreter', () => {
    const interpret = jest.fn().mockReturnValue({ type: 'decline' });
    const source = createHostedFormPublicUrlSource({
      url: 'https://form',
      interpret,
    });
    expect(source.interpret({ type: 'x' })).toEqual({ type: 'decline' });
  });
});
