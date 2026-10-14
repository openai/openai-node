/** Capture actual browser pixels without retaining a frame queue. */
export async function createLiveView(page) {
  let frame = null;
  let state = { status: 'starting', sequence: 0, at: 0, width: 0, height: 0 };
  const closed = () => {
    frame = null;
    state = { ...state, status: 'closed' };
  };
  page.once('close', closed);
  let capture;
  try {
    capture = await page.screencast.start({
      size: page.viewportSize(),
      quality: 75,
      onFrame(value) {
        if (state.status === 'closed') {
          return;
        }
        frame = value.data;
        state = {
          status: 'live',
          sequence: state.sequence + 1,
          at: value.timestamp,
          width: value.viewportWidth,
          height: value.viewportHeight,
        };
      },
    });
  } catch (error) {
    page.off('close', closed);
    closed();
    throw error;
  }
  return {
    get frame() {
      return frame;
    },
    get state() {
      return { ...state };
    },
    async close() {
      page.off('close', closed);
      closed();
      await capture.dispose();
    },
  };
}
