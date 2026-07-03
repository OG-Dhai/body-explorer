import eventBus from '../core/eventBus.js';
import { i18n } from '../core/i18n.js';

export class HUDOverlay {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._container = container;
    this._container.className = 'hud-container';
    
    // Create inner card
    this._hudCard = document.createElement('div');
    this._hudCard.className = 'hud-card';
    this._container.appendChild(this._hudCard);
    
    // Create playing section container
    this._playingSection = document.createElement('div');
    this._playingSection.className = 'playing-section';
    this._playingSection.style.display = 'none';
    this._playingSection.style.flexDirection = 'column';
    this._playingSection.style.alignItems = 'center';
    this._playingSection.style.gap = '1.5rem';
    this._playingSection.style.width = '100%';
    
    // HUD inner HTML
    this._playingSection.innerHTML = `
      <div class="hud-top-bar">
        <div class="hud-progress" id="hud-progress">Question 1 of 5</div>
        <div class="hud-streak" id="hud-streak">Streak: 0</div>
      </div>
      <div class="hud-score-container">
        <span class="hud-score-value" id="hud-score">Score: 0</span>
      </div>
      <div class="hud-instruction">
        <div class="hud-instruction-text" id="hud-target">Touch your...</div>
      </div>
      <div class="hud-hold-bar-container">
        <div class="hud-hold-bar" id="hud-hold-bar"></div>
      </div>
      <div class="hud-feedback-text" id="hud-feedback"></div>
    `;
    this._hudCard.appendChild(this._playingSection);
    
    // Cache references
    this._scoreEl = this._playingSection.querySelector('#hud-score');
    this._targetEl = this._playingSection.querySelector('#hud-target');
    this._progressEl = this._playingSection.querySelector('#hud-progress');
    this._streakEl = this._playingSection.querySelector('#hud-streak');
    this._holdBar = this._playingSection.querySelector('#hud-hold-bar');
    this._feedbackEl = this._playingSection.querySelector('#hud-feedback');

    // Create victory section container
    this._victorySection = document.createElement('div');
    this._victorySection.className = 'victory-section';
    this._victorySection.style.display = 'none';
    this._victorySection.style.width = '100%';
    this._victorySection.innerHTML = `
      <div class="victory-message">
        <h2 id="victory-title">YAY! YOU DID IT!</h2>
        <p id="victory-subtitle">Great job exploring your body!</p>
        
        <div class="victory-stats">
          <div class="stat-row">
            <span id="label-final-score">Final Score</span>
            <strong id="val-final-score">0</strong>
          </div>
          <div class="stat-row">
            <span id="label-best-streak">Best Streak</span>
            <strong id="val-best-streak">0</strong>
          </div>
          <div class="stat-row">
            <span id="label-avg-time">Avg Time</span>
            <strong id="val-avg-time">0s</strong>
          </div>
        </div>

        <button id="btn-restart" class="interactive-btn" type="button">PLAY AGAIN</button>
      </div>
    `;
    this._hudCard.appendChild(this._victorySection);
    
    // Cache restart button and bind listener
    const btnRestart = this._victorySection.querySelector('#btn-restart');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        eventBus.emit('ui:restartClick');
      });
    }

    // Default card visibility
    this._hudCard.style.display = 'none';

    this._bindEvents();
    this._updateTranslations();
  }

  _bindEvents() {
    eventBus.on('game:stateChange', ({ state }) => {
      if (state === 'idle') {
        this._hudCard.style.display = 'none';
      } else if (state === 'playing') {
        this._hudCard.style.display = 'block';
        this._playingSection.style.display = 'flex';
        this._victorySection.style.display = 'none';
        this._feedbackEl.textContent = '';
        this._feedbackEl.classList.remove('show');
      }
    });

    eventBus.on('game:newQuestion', ({ question, progress, stats }) => {
      this._hudCard.style.display = 'block';
      this._playingSection.style.display = 'flex';
      this._victorySection.style.display = 'none';
      
      this._scoreEl.textContent = `${i18n.t('ui.score')}: ${stats.score}`;
      this._progressEl.textContent = i18n.t('ui.question_of', progress.current, progress.total);
      this._streakEl.textContent = i18n.t('ui.streak', stats.streak);
      this._targetEl.textContent = i18n.t(question.instKey);
      
      this._feedbackEl.textContent = '';
      this._feedbackEl.classList.remove('show');
      this._holdBar.style.width = '0%';
    });

    eventBus.on('detection:progress', ({ progress }) => {
      // progress is 0 to 1
      this._holdBar.style.width = `${progress * 100}%`;
    });

    eventBus.on('game:hit', ({ points, stats, reactionTime }) => {
      this._scoreEl.textContent = `${i18n.t('ui.score')}: ${stats.score}`;
      this._streakEl.textContent = i18n.t('ui.streak', stats.streak);
      
      let feedbackKey = 'fb.nice';
      if (reactionTime < 3000) feedbackKey = 'fb.lightning';
      else if (reactionTime < 6000) feedbackKey = 'fb.great';
      
      this._feedbackEl.textContent = i18n.t(feedbackKey);
      this._feedbackEl.classList.add('show');
    });

    eventBus.on('game:complete', ({ stats }) => {
      this._playingSection.style.display = 'none';
      this._victorySection.style.display = 'block';
      
      this._victorySection.querySelector('#val-final-score').textContent = stats.score;
      this._victorySection.querySelector('#val-best-streak').textContent = stats.bestStreak;
      this._victorySection.querySelector('#val-avg-time').textContent = `${(stats.avgTime / 1000).toFixed(1)}s`;
    });

    eventBus.on('i18n:change', () => {
      this._updateTranslations();
    });
  }

  _updateTranslations() {
    this._victorySection.querySelector('#victory-title').textContent = i18n.t('ui.victory_title');
    this._victorySection.querySelector('#victory-subtitle').textContent = i18n.t('ui.victory_subtitle');
    this._victorySection.querySelector('#label-final-score').textContent = i18n.t('ui.final_score');
    this._victorySection.querySelector('#label-best-streak').textContent = i18n.t('ui.best_streak');
    this._victorySection.querySelector('#label-avg-time').textContent = i18n.t('ui.avg_time');
    const btnRestart = this._victorySection.querySelector('#btn-restart');
    if (btnRestart) btnRestart.textContent = i18n.t('ui.play_again');
  }

  dispose() {
    this._container.innerHTML = '';
  }
}
