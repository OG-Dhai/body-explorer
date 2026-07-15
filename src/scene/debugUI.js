import eventBus from '../core/eventBus.js';
import { PALETTE } from '../core/palette.js';

export function setupDebugUI(gameEngine) {
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('debug')) return null;

  document.getElementById('debug-ui')?.remove();
  let jumpTimerId = null;

  const container = document.createElement('div');
  container.id = 'debug-ui';
  container.style.position = 'fixed';
  container.style.top = '10px';
  container.style.right = '10px';
  container.style.backgroundColor = PALETTE.airySky;
  container.style.border = `3px solid ${PALETTE.explorerNavy}`;
  container.style.color = PALETTE.explorerNavy;
  container.style.padding = '10px';
  container.style.zIndex = '9999';
  container.style.fontFamily = 'monospace';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';

  const title = document.createElement('div');
  title.textContent = 'DEV MODE';
  title.style.fontWeight = 'bold';
  title.style.color = PALETTE.explorerNavy;
  title.style.backgroundColor = PALETTE.friendlyCoral;
  title.style.padding = '4px';
  title.style.textAlign = 'center';
  title.style.marginBottom = '5px';
  container.appendChild(title);

  const createBtn = (text, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.padding = '5px 10px';
    btn.style.cursor = 'pointer';
    btn.style.backgroundColor = PALETTE.airySky;
    btn.style.color = PALETTE.explorerNavy;
    btn.style.border = `1px solid ${PALETTE.explorerNavy}`;
    btn.addEventListener('click', onClick);
    container.appendChild(btn);
    return btn;
  };

  const btnHit = createBtn('Force HIT', () => {
    if (gameEngine._fsm.is('DETECTING')) {
      eventBus.emit('detection:success', { holdTime: 500 });
    } else {
      console.warn('Debug: Must be in DETECTING state to force HIT');
    }
  });

  const btnTimeout = createBtn('Force TIMEOUT', () => {
    if (gameEngine._fsm.is('DETECTING')) {
      gameEngine._fsm.transition('TIMEOUT');
    } else {
      console.warn('Debug: Must be in DETECTING state to force TIMEOUT');
    }
  });

  const btnWin = createBtn('Force Level Win', () => {
    if (gameEngine._fsm.is('DETECTING')) {
      gameEngine._scoring._levelAnswered = 5;
      gameEngine._scoring._levelBestStreak = 5;
      if (gameEngine.debugForceLevelEnd) {
        gameEngine.debugForceLevelEnd();
      }
    }
  });

  const btnFail = createBtn('Force Level Fail', () => {
    if (gameEngine._fsm.is('DETECTING')) {
      gameEngine._scoring._levelAnswered = 0;
      gameEngine._scoring._levelBestStreak = 0;
      if (gameEngine.debugForceLevelEnd) {
        gameEngine.debugForceLevelEnd();
      }
    }
  });

  const jumpBtns = [];

  [1, 2, 3].forEach(level => {
    const btn = createBtn(`Jump to Level ${level}`, () => {
      // 1. Explicitly clean up stale timeouts
      gameEngine.debugClearTimers?.();
      
      // 2. Exactly replicate IDLE's full reset logic
      gameEngine._scoring.reset();
      gameEngine._currentLevel = 1;
      gameEngine._lastLevelPassed = false;
      
      // 3. Brute force internal state
      gameEngine._fsm._currentState = 'IDLE'; 
      eventBus.emit('game:stateChange', { state: 'idle' });
      
      if (jumpTimerId !== null) clearTimeout(jumpTimerId);
      jumpTimerId = setTimeout(() => {
        jumpTimerId = null;
        if (gameEngine.isDisposed) return;
        gameEngine._currentLevel = level;
        gameEngine._fsm.transition('START');
      }, 100);
    });
    jumpBtns.push(btn);
  });

  const updateBtns = () => {
    const isDetecting = gameEngine._fsm.is('DETECTING');
    const isIdle = gameEngine._fsm.is('IDLE') || gameEngine._fsm.is('COMPLETE');

    const updateBtnState = (btn, enabled) => {
      btn.disabled = !enabled;
      btn.style.opacity = '1';
      btn.style.filter = enabled ? 'none' : 'saturate(0.65)';
      btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    };

    updateBtnState(btnHit, isDetecting);
    updateBtnState(btnTimeout, isDetecting);
    updateBtnState(btnWin, isDetecting);
    updateBtnState(btnFail, isDetecting);

    jumpBtns.forEach(btn => updateBtnState(btn, isIdle));
  };

  eventBus.on('game:stateChange', updateBtns);
  updateBtns();

  document.body.appendChild(container);

  return () => {
    if (jumpTimerId !== null) clearTimeout(jumpTimerId);
    eventBus.off('game:stateChange', updateBtns);
    container.remove();
  };
}
