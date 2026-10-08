// Glim's soundtrack player: loops the added Piki Momo track after a user gesture.
const Music = (() => {
  const trackUrl = encodeURI('Piki - Momo Island (freetouse.com).mp3');
  const sceneVolume = {
    world: 0.32,
    flight: 0.38,
    fairy: 0.28,
  };

  let audio = null;
  let currentScene = 'world';

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(trackUrl);
    audio.loop = true;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.volume = sceneVolume.world;
    audio.addEventListener('error', (event) => {
      console.warn('Soundtrack failed to load:', event);
    });
    return audio;
  }

  function setVolume(scene) {
    if (!audio) return;
    audio.volume = sceneVolume[scene] ?? sceneVolume.world;
  }

  async function start(scene = 'world') {
    const player = ensureAudio();
    currentScene = sceneVolume[scene] ? scene : 'world';
    setVolume(currentScene);

    if (player.paused || player.ended) {
      try {
        await player.play();
      } catch (err) {
        console.warn('Soundtrack playback was blocked or failed:', err);
      }
    }
  }

  function stop() {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  return { start, stop };
})();