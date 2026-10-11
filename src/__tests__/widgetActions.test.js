// The action bridge must not drop presses that arrive before App.js mounts.
const { emitWidgetAction, setWidgetActionListener } = require('../widgetActions');

afterEach(() => setWidgetActionListener(null));

describe('widgetActions bridge', () => {
  test('delivers immediately when a listener is registered', () => {
    const fn = jest.fn();
    setWidgetActionListener(fn);
    emitWidgetAction('skip-rest');
    expect(fn).toHaveBeenCalledWith('skip-rest');
  });

  test('buffers an action emitted before the listener registers', () => {
    emitWidgetAction('log-same');
    const fn = jest.fn();
    setWidgetActionListener(fn);
    expect(fn).toHaveBeenCalledWith('log-same');
  });

  test('buffered action fires only once', () => {
    emitWidgetAction('log-same');
    const fn = jest.fn();
    setWidgetActionListener(fn);
    setWidgetActionListener(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
