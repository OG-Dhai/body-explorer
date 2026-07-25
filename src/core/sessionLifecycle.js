// Kick off all the realtime subsystems in one tick. We start the audio resume
// and schedule the next camera frame before awaiting anything, so resuming
// doesn't show a visible stutter.
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
