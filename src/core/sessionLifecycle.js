/**
 * Resume every real-time subsystem in one JavaScript task. In particular,
 * AudioContext.resume() is requested and camera frame delivery is scheduled
 * before either asynchronous operation is awaited, preventing a visible gap.
 */
export function resumeSessionInSameTick({
  resumeAudio,
  resumeCamera,
  resumeGame,
  resumeRender,
}) {
  const audioResumePromise = resumeAudio();
  const cameraResumed = resumeCamera();
  const gameResumed = resumeGame();
  resumeRender();

  return {
    audioResumePromise,
    cameraResumed,
    gameResumed,
  };
}
