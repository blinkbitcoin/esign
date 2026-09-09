// The bridge scripts ship to the browser as strings interpolated into a
// <script> tag, so the only honest way to test them is to run them the way
// the page does: one script, one `window`.

/* eslint-disable no-new-func */

import { POST_SESSION_END_SCRIPT } from '../../providers/docusign/mockWebFormPage';
import { POST_SIGNING_EVENT_SCRIPT } from '../script';

interface FakeWindow {
  ReactNativeWebView?: { postMessage?: (body: string) => void };
  parent?: unknown;
}

// Runs the script against a fake window and hands back the function it
// defines (both scripts define a single top-level function named
// postSigningEvent, just with a different parameter and payload shape).
const install = (window: FakeWindow, script: string): ((arg: string) => void) =>
  new Function('window', `${script}\nreturn postSigningEvent;`)(window) as (
    arg: string,
  ) => void;

/** A React Native host: the WebView's postMessage takes a JSON string. */
const reactNative = (): {
  window: FakeWindow;
  postMessage: ReturnType<typeof jest.fn>;
} => {
  const postMessage = jest.fn();
  return { window: { ReactNativeWebView: { postMessage } }, postMessage };
};

/** A web host: the page is in an iframe, so window.parent is someone else. */
const iframe = (): {
  window: FakeWindow;
  postMessage: ReturnType<typeof jest.fn>;
} => {
  const postMessage = jest.fn();
  return { window: { parent: { postMessage } }, postMessage };
};

describe.each([
  [
    'POST_SIGNING_EVENT_SCRIPT',
    POST_SIGNING_EVENT_SCRIPT,
    (event: string) => ({ event }),
  ],
  [
    'POST_SESSION_END_SCRIPT',
    POST_SESSION_END_SCRIPT,
    (type: string) => ({ event: 'sessionEnd', type }),
  ],
] as const)('%s', (_name, script, expectedPayload) => {
  it('posts a JSON-stringified payload through the React Native WebView', () => {
    const host = reactNative();
    const postSigningEvent = install(host.window, script);

    postSigningEvent('signing_complete');

    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage).toHaveBeenCalledWith(
      JSON.stringify(expectedPayload('signing_complete')),
    );
  });

  it('posts the same JSON string to the iframe parent, with a wildcard origin', () => {
    // '*' is deliberate: the host pins the origin on its side (the page is
    // embedded by whoever the app says, and it cannot know that origin).
    const host = iframe();
    const postSigningEvent = install(host.window, script);

    postSigningEvent('signing_complete');

    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage).toHaveBeenCalledWith(
      JSON.stringify(expectedPayload('signing_complete')),
      '*',
    );
  });

  it('posts nowhere at the top level (no ReactNativeWebView, no parent)', () => {
    // Opened directly in a browser tab: window.parent === window. Nothing to
    // talk to, and no throw either - the page still runs.
    const window: FakeWindow = {};
    const postSigningEvent = install(window, script);
    window.parent = window;

    expect(() => postSigningEvent('signing_complete')).not.toThrow();
  });

  it('posts nowhere when there is no parent to speak of either', () => {
    const postSigningEvent = install({}, script);

    expect(() => postSigningEvent('signing_complete')).not.toThrow();
  });

  it('prefers React Native when both transports are present', () => {
    const native = reactNative();
    const web = iframe();
    const postSigningEvent = install(
      { ...native.window, ...web.window },
      script,
    );

    postSigningEvent('signing_complete');

    expect(native.postMessage).toHaveBeenCalledTimes(1);
    expect(web.postMessage).not.toHaveBeenCalled();
  });

  it('falls through to the parent when ReactNativeWebView cannot post', () => {
    // An object without postMessage is not a transport - an old or partially
    // initialised WebView must not swallow the event.
    const host = iframe();
    const postSigningEvent = install(
      { ...host.window, ReactNativeWebView: {} },
      script,
    );

    postSigningEvent('signing_complete');

    expect(host.postMessage).toHaveBeenCalledWith(
      JSON.stringify(expectedPayload('signing_complete')),
      '*',
    );
  });
});
