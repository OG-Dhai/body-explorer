import eventBus from '../core/eventBus.js';
import { i18n } from '../core/i18n.js';
import { PALETTE } from '../core/palette.js';

function formatSeconds(seconds, unitDisplay = 'narrow') {
  return new Intl.NumberFormat(i18n.getLocale(), {
    style: 'unit',
    unit: 'second',
    unitDisplay,
    maximumFractionDigits: 1,
  }).format(seconds);
}

export class HUDOverlay {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._container = container;
    this._container.className = 'hud-container';
    
    this._hudCard = document.createElement('div');
    this._hudCard.className = 'hud-card';
    this._container.appendChild(this._hudCard);
    
    this._playingSection = document.createElement('div');
    this._playingSection.className = 'playing-section';
    this._playingSection.setAttribute('role', 'group');
    this._playingSection.style.display = 'none';
    this._playingSection.style.flexDirection = 'column';
    this._playingSection.style.alignItems = 'center';
    this._playingSection.style.gap = '1.5rem';
    this._playingSection.style.width = '100%';
    
    this._playingSection.innerHTML = `
      <div class="hud-top-bar" role="group">
        <div class="hud-pill hud-level">
          <svg class="ui-icon hud-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-trophy"></use></svg>
          <span class="hud-label" id="label-hud-level">Level</span>
          <span class="hud-value hud-level-info" id="hud-level-info" role="status">1</span>
        </div>
        <div class="hud-pill hud-progress-pill">
          <svg class="ui-icon hud-icon icon--leaf" aria-hidden="true" focusable="false"><use href="#icon-progress"></use></svg>
          <span class="hud-label" id="label-hud-question">Question</span>
          <span class="hud-value hud-progress" id="hud-progress" role="status">1/5</span>
        </div>
        <div class="hud-pill hud-score-container" role="group">
          <svg class="ui-icon hud-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-star"></use></svg>
          <span class="hud-label" id="label-hud-score">Score</span>
          <span class="hud-value hud-score-value" id="hud-score" role="status">0</span>
        </div>
        <div class="hud-pill hud-streak-pill">
          <svg class="ui-icon hud-icon icon--coral" aria-hidden="true" focusable="false"><use href="#icon-bolt"></use></svg>
          <span class="hud-label" id="label-hud-streak">Streak</span>
          <span class="hud-value hud-streak" id="hud-streak" role="status">0</span>
        </div>
        <div class="hud-pill hud-timer">
          <svg class="ui-icon hud-icon icon--coral" aria-hidden="true" focusable="false"><use href="#icon-clock"></use></svg>
          <span class="hud-label" id="label-hud-time">Time</span>
          <span class="hud-value hud-timer-value" id="hud-timer" role="timer">0s</span>
        </div>
      </div>
      <div class="instruction-panel hud-instruction" role="region" aria-labelledby="hud-target">
        <div class="instruction-glow" aria-hidden="true"></div>
        <div class="instruction-content">
          <img class="ui-icon instruction-emoji" src="/icons/icon-pointer.png" alt="" aria-hidden="true" draggable="false" />
          <p class="instruction-text hud-instruction-text" id="hud-target">Touch your...</p>
        </div>
        <svg class="ui-icon instruction-arrow icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-chevron"></use></svg>
      </div>
      <div class="hold-progress-container hud-hold-bar-container" role="progressbar" aria-labelledby="label-hud-hold" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="hold-progress-track">
          <div class="hold-progress-fill hud-hold-bar" id="hud-hold-bar" aria-hidden="true"></div>
        </div>
        <span class="hold-progress-label" id="label-hud-hold">Hold it!</span>
      </div>
      <div class="feedback-popup hud-feedback-text" id="hud-feedback" role="status" aria-live="assertive">
        <svg class="ui-icon feedback-burst icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-sparkle"></use></svg>
        <h2 class="feedback-title" id="hud-feedback-title"></h2>
        <p class="feedback-sub">Amazing move!</p>
      </div>
    `;
    this._hudCard.appendChild(this._playingSection);
    
    this._scoreEl = this._playingSection.querySelector('#hud-score');
    this._timerEl = this._playingSection.querySelector('#hud-timer');
    this._levelInfoEl = this._playingSection.querySelector('#hud-level-info');
    this._targetEl = this._playingSection.querySelector('#hud-target');
    this._progressEl = this._playingSection.querySelector('#hud-progress');
    this._streakEl = this._playingSection.querySelector('#hud-streak');
    this._holdBar = this._playingSection.querySelector('#hud-hold-bar');
    this._holdBarContainer = this._playingSection.querySelector('.hud-hold-bar-container');
    this._feedbackEl = this._playingSection.querySelector('#hud-feedback');
    this._feedbackTitleEl = this._playingSection.querySelector('#hud-feedback-title');
    this._feedbackSubEl = this._playingSection.querySelector('.feedback-sub');
    this._lastFeedbackKey = null;
    this._lastFactKey = null;
    this._timerInterval = null;
    this._timerEndTime = 0;
    this._timerRemainingMs = 0;
    this._timerPaused = false;
    this._lastSecs = null;

    this._transitionSection = document.createElement('div');
    this._transitionSection.className = 'transition-section';
    this._transitionSection.setAttribute('role', 'region');
    this._transitionSection.setAttribute('aria-live', 'polite');
    this._transitionSection.setAttribute('aria-labelledby', 'transition-title');
    this._transitionSection.style.display = 'none';
    this._transitionSection.style.flexDirection = 'column';
    this._transitionSection.style.alignItems = 'center';
    this._transitionSection.style.justifyContent = 'center';
    this._transitionSection.style.gap = '1.5rem';
    this._transitionSection.innerHTML = `
      <svg class="ui-icon modal-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-trophy"></use></svg>
      <h2 class="modal-title" id="transition-title">Level Complete!</h2>
      <p class="modal-message" id="transition-subtitle"></p>
      <div class="modal-stats transition-stats">
        <div class="stat-item">
          <svg class="ui-icon stat-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-star"></use></svg>
          <span class="stat-label" id="label-transition-score">Score</span>
          <strong class="stat-value" id="trans-score">0</strong>
        </div>
      </div>
    `;
    this._hudCard.appendChild(this._transitionSection);

    this._victorySection = document.createElement('div');
    this._victorySection.className = 'victory-section';
    this._victorySection.setAttribute('role', 'region');
    this._victorySection.setAttribute('aria-labelledby', 'victory-title');
    this._victorySection.style.display = 'none';
    this._victorySection.innerHTML = `
      <div class="victory-message">
        <svg class="ui-icon modal-icon icon--coral" aria-hidden="true" focusable="false"><use href="#icon-medal"></use></svg>
        <h2 class="modal-title" id="victory-title">YAY! YOU DID IT!</h2>
        <p class="modal-message" id="victory-subtitle">Great job exploring your body!</p>
        
        <div class="modal-stats victory-stats">
          <div class="stat-item">
            <svg class="ui-icon stat-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-trophy"></use></svg>
            <span class="stat-label" id="label-final-score">Final Score</span>
            <strong class="stat-value" id="val-final-score">0</strong>
          </div>
          <div class="stat-item">
            <svg class="ui-icon stat-icon icon--coral" aria-hidden="true" focusable="false"><use href="#icon-bolt"></use></svg>
            <span class="stat-label" id="label-best-streak">Best Streak</span>
            <strong class="stat-value" id="val-best-streak">0</strong>
          </div>
          <div class="stat-item">
            <svg class="ui-icon stat-icon icon--leaf" aria-hidden="true" focusable="false"><use href="#icon-clock"></use></svg>
            <span class="stat-label" id="label-avg-time">Avg Time</span>
            <strong class="stat-value" id="val-avg-time">0s</strong>
          </div>
        </div>

        <button id="btn-restart" class="btn-modal btn-restart interactive-btn" type="button" aria-label="Play Body Explorer again">
          <svg class="ui-icon icon--apricot" aria-hidden="true" focusable="false"><use href="#icon-restart"></use></svg>
          <span class="btn-modal-label">PLAY AGAIN</span>
        </button>
      </div>
    `;
    this._hudCard.appendChild(this._victorySection);
    
    this._hudCard.style.display = 'none';

    this._onGameStateChange = this._onGameStateChange.bind(this);
    this._onLevelStart = this._onLevelStart.bind(this);
    this._onLevelComplete = this._onLevelComplete.bind(this);
    this._onLevelUnlocked = this._onLevelUnlocked.bind(this);
    this._onGameNewQuestion = this._onGameNewQuestion.bind(this);
    this._onDetectionProgress = this._onDetectionProgress.bind(this);
    this._onGameHit = this._onGameHit.bind(this);
    this._onGameMiss = this._onGameMiss.bind(this);
    this._onGameComplete = this._onGameComplete.bind(this);
    this._onGamePauseChange = this._onGamePauseChange.bind(this);
    this._onI18nChange = this._onI18nChange.bind(this);
    this._onRestartClick = this._onRestartClick.bind(this);

    const btnRestart = this._victorySection.querySelector('#btn-restart');
    if (btnRestart) {
      this._btnRestart = btnRestart;
      this._btnRestart.addEventListener('click', this._onRestartClick);
    }

    this._bindEvents();
    this._updateTranslations();
  }

  _bindEvents() {
    eventBus.on('game:stateChange', this._onGameStateChange);
    eventBus.on('level:start', this._onLevelStart);
    eventBus.on('level:complete', this._onLevelComplete);
    eventBus.on('level:unlocked', this._onLevelUnlocked);
    eventBus.on('game:newQuestion', this._onGameNewQuestion);
    eventBus.on('detection:progress', this._onDetectionProgress);
    eventBus.on('game:hit', this._onGameHit);
    eventBus.on('game:miss', this._onGameMiss);
    eventBus.on('game:complete', this._onGameComplete);
    eventBus.on('game:pauseChange', this._onGamePauseChange);
    eventBus.on('i18n:change', this._onI18nChange);
  }

  _onRestartClick() {
    eventBus.emit('ui:restartClick');
  }

  _onGameStateChange({ state }) {
    if (state === 'idle') {
      this._hudCard.style.display = 'none';
      this._stopTimer();
    } else if (state === 'playing') {
      this._hudCard.style.display = 'block';
      this._playingSection.style.display = 'flex';
      this._transitionSection.style.display = 'none';
      this._victorySection.style.display = 'none';
      this._feedbackTitleEl.textContent = '';
      this._lastFeedbackKey = null;
      this._lastFactKey = null;
      this._feedbackSubEl.textContent = i18n.t('ui.amazing_move');
      this._feedbackEl.classList.remove('show');

      this._startTimer(this._currentTimeoutMs || 10000);
    }
  }

  _startTimer(durationMs) {
    this._stopTimer();
    this._timerPaused = false;
    this._lastSecs = null;
    this._timerRemainingMs = Math.max(0, durationMs);
    this._timerEndTime = performance.now() + this._timerRemainingMs;
    this._timerInterval = requestAnimationFrame(() => this._updateTimer());
  }

  _stopTimer() {
    if (this._timerInterval !== null) {
      cancelAnimationFrame(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _updateTimer() {
    this._timerInterval = null;
    if (this._timerPaused || this._playingSection.style.display === 'none') return;

    const remaining = Math.max(0, this._timerEndTime - performance.now());
    this._timerRemainingMs = remaining;
    const secs = Math.ceil(remaining / 1000);

    if (this._lastSecs !== secs) {
      this._timerEl.textContent = formatSeconds(secs);
      this._lastSecs = secs;
      this._timerEl.style.backgroundColor = remaining < 3000
        ? PALETTE.friendlyCoral
        : '';
      this._timerEl.setAttribute(
        'aria-label',
        i18n.t('ui.time_remaining', formatSeconds(secs, 'long'))
      );
    }

    if (remaining > 0) {
      this._timerInterval = requestAnimationFrame(() => this._updateTimer());
    }
  }

  _onGamePauseChange({ paused, questionRemainingMs } = {}) {
    if (paused) {
      this._timerPaused = true;
      this._timerRemainingMs = Number.isFinite(questionRemainingMs)
        ? Math.max(0, questionRemainingMs)
        : Math.max(0, this._timerEndTime - performance.now());
      this._stopTimer();
      return;
    }

    this._timerPaused = false;
    if (this._playingSection.style.display !== 'none' && this._timerRemainingMs > 0) {
      this._timerEndTime = performance.now() + this._timerRemainingMs;
      this._timerInterval = requestAnimationFrame(() => this._updateTimer());
    }
  }

  _onLevelStart({ level, params }) {
      this._hudCard.style.display = 'block';
      this._playingSection.style.display = 'flex';
      this._transitionSection.style.display = 'none';
      this._victorySection.style.display = 'none';

      this._currentLevel = level;
      this._currentLevelParams = params;
      this._unlockedLevel = null;

      const levelNameKey = `ui.level_${params.name}`;
      const levelLabel = `${i18n.t('ui.level', level)}: ${i18n.t(levelNameKey)}`;
      this._levelInfoEl.textContent = `${level}`;
      this._levelInfoEl.setAttribute('aria-label', levelLabel);
      this._currentTimeoutMs = params.questionTimeout;
  }

  _onLevelComplete({ passed, stats, levelParams }) {
      this._playingSection.style.display = 'none';
      this._transitionSection.style.display = 'flex';
      this._victorySection.style.display = 'none';

      this._transitionPassed = passed;
      this._currentStats = stats;
      this._currentLevelParams = levelParams;

      if (passed) {
        this._transitionSection.querySelector('#transition-title').textContent = i18n.t('ui.level_complete');
        this._transitionSection.querySelector('#transition-subtitle').textContent = '';
      } else {
        this._transitionSection.querySelector('#transition-title').textContent = i18n.t('ui.level_failed');
        if (levelParams.comboRequirement > 0 && stats.levelAnswered >= 3 && stats.levelBestStreak < levelParams.comboRequirement) {
          this._transitionSection.querySelector('#transition-subtitle').textContent = i18n.t('ui.combo_needed', levelParams.comboRequirement);
        } else {
          this._transitionSection.querySelector('#transition-subtitle').textContent = '';
        }
      }
      this._transitionSection.querySelector('#trans-score').textContent = stats.levelScore;
  }

  _onLevelUnlocked({ level }) {
      this._unlockedLevel = level;
      this._transitionSection.querySelector('#transition-subtitle').textContent = i18n.t('ui.level_unlocked', level);
  }

  _onGameNewQuestion({ question, progress, stats }) {
      this._hudCard.style.display = 'block';
      this._playingSection.style.display = 'flex';
      this._transitionSection.style.display = 'none';
      this._victorySection.style.display = 'none';
      
      this._currentStats = stats;
      this._currentProgress = progress;
      this._currentInstKey = question.instKey;

      this._scoreEl.textContent = stats.score;
      this._progressEl.textContent = `${progress.current}/${progress.total}`;
      this._streakEl.textContent = stats.streak;
      this._targetEl.textContent = i18n.t(question.instKey);
      this._scoreEl.setAttribute('aria-label', `${i18n.t('ui.score')}: ${stats.score}`);
      this._progressEl.setAttribute('aria-label', i18n.t('ui.question_of', progress.current, progress.total));
      this._streakEl.setAttribute('aria-label', i18n.t('ui.streak', stats.streak));
      this._targetEl.setAttribute('aria-label', this._targetEl.textContent);
      
      this._feedbackTitleEl.textContent = '';
      this._lastFactKey = null;
      this._feedbackEl.removeAttribute('aria-label');
      this._feedbackEl.classList.remove('show');
      this._holdBar.style.width = '0%';
      this._holdBarContainer.classList.remove('visible');
      this._holdBarContainer.setAttribute('aria-valuenow', '0');
      this._timerEl.style.color = '';
  }

  _onDetectionProgress({ progress }) {
      // progress is 0 to 1
      this._holdBar.style.width = `${progress * 100}%`;
      this._holdBarContainer.classList.toggle('visible', progress > 0);
      this._holdBarContainer.setAttribute('aria-valuenow', `${Math.round(progress * 100)}`);
  }

  _onGameHit({ stats, reactionTime, voiceKey, factKey }) {
      this._stopTimer();
      this._currentStats = stats;
      this._scoreEl.textContent = stats.score;
      this._streakEl.textContent = stats.streak;
      this._scoreEl.setAttribute('aria-label', `${i18n.t('ui.score')}: ${stats.score}`);
      this._streakEl.setAttribute('aria-label', i18n.t('ui.streak', stats.streak));
      
      let feedbackKey = voiceKey || 'fb.nice';
      if (!voiceKey && reactionTime < 3000) feedbackKey = 'fb.lightning';
      else if (!voiceKey && reactionTime < 6000) feedbackKey = 'fb.great';
      
      this._lastFeedbackKey = feedbackKey;
      this._lastFactKey = factKey || null;
      this._feedbackTitleEl.textContent = i18n.t(feedbackKey);
      this._feedbackSubEl.textContent = this._lastFactKey
        ? i18n.t(this._lastFactKey)
        : i18n.t('ui.amazing_move');
      this._feedbackEl.setAttribute(
        'aria-label',
        `${this._feedbackTitleEl.textContent} ${this._feedbackSubEl.textContent}`.trim()
      );
      this._feedbackEl.classList.add('show');
  }

  _onGameMiss({ stats }) {
      this._stopTimer();
      this._currentStats = stats;
      this._lastFactKey = null;
      this._lastFeedbackKey = 'ui.timeout';
      this._scoreEl.textContent = stats.score;
      this._streakEl.textContent = stats.streak;
      this._lastSecs = 0;
      this._timerEl.textContent = formatSeconds(0);
      this._feedbackTitleEl.textContent = i18n.t('ui.timeout');
      this._feedbackSubEl.textContent = '';
      this._scoreEl.setAttribute('aria-label', `${i18n.t('ui.score')}: ${stats.score}`);
      this._streakEl.setAttribute('aria-label', i18n.t('ui.streak', stats.streak));
      this._timerEl.setAttribute(
        'aria-label',
        i18n.t('ui.time_remaining', formatSeconds(0, 'long'))
      );
      this._feedbackEl.setAttribute('aria-label', this._feedbackTitleEl.textContent);
      this._feedbackEl.classList.add('show');
  }

  _onGameComplete({ stats, allLevelsPassed }) {
      this._playingSection.style.display = 'none';
      this._transitionSection.style.display = 'none';
      this._victorySection.style.display = 'block';
      
      if (allLevelsPassed) {
        this._victorySection.querySelector('#victory-title').textContent = i18n.t('ui.game_complete_title');
        this._victorySection.querySelector('#victory-subtitle').textContent = i18n.t('ui.game_complete_subtitle');
      } else {
        this._victorySection.querySelector('#victory-title').textContent = i18n.t('ui.game_over_title');
        this._victorySection.querySelector('#victory-subtitle').textContent = i18n.t('ui.game_over_subtitle');
      }

      this._finalStats = stats;
      this._victorySection.querySelector('#val-final-score').textContent = stats.score;
      this._victorySection.querySelector('#val-best-streak').textContent = stats.bestStreak;
      this._victorySection.querySelector('#val-avg-time').textContent = formatSeconds(stats.avgTime / 1000);
  }

  _onI18nChange() {
      this._updateTranslations();
  }

  _updateTranslations() {
    this._playingSection.setAttribute('aria-label', i18n.t('ui.aria_hud'));
    this._victorySection.querySelector('#victory-title').textContent = i18n.t('ui.game_complete_title');
    this._victorySection.querySelector('#victory-subtitle').textContent = i18n.t('ui.game_complete_subtitle');
    this._victorySection.querySelector('#label-final-score').textContent = i18n.t('ui.final_score');
    this._victorySection.querySelector('#label-best-streak').textContent = i18n.t('ui.best_streak');
    this._victorySection.querySelector('#label-avg-time').textContent = i18n.t('ui.avg_time');
    this._transitionSection.querySelector('#label-transition-score').textContent = i18n.t('ui.score');

    this._playingSection.querySelector('#label-hud-level').textContent = i18n.t('ui.label_level');
    this._playingSection.querySelector('#label-hud-question').textContent = i18n.t('ui.label_question');
    this._playingSection.querySelector('#label-hud-score').textContent = i18n.t('ui.label_score');
    this._playingSection.querySelector('#label-hud-streak').textContent = i18n.t('ui.label_streak');
    this._playingSection.querySelector('#label-hud-time').textContent = i18n.t('ui.label_time');
    this._playingSection.querySelector('#label-hud-hold').textContent = i18n.t('ui.hold_it');
    const displayedSeconds = Number.isFinite(this._lastSecs) ? this._lastSecs : 0;
    this._timerEl.textContent = formatSeconds(displayedSeconds);
    this._timerEl.setAttribute(
      'aria-label',
      i18n.t('ui.time_remaining', formatSeconds(displayedSeconds, 'long'))
    );
    if (this._lastFeedbackKey) {
      this._feedbackTitleEl.textContent = i18n.t(this._lastFeedbackKey);
      this._feedbackSubEl.textContent = this._lastFeedbackKey === 'ui.timeout'
        ? ''
        : this._lastFactKey
          ? i18n.t(this._lastFactKey)
          : i18n.t('ui.amazing_move');
      this._feedbackEl.setAttribute(
        'aria-label',
        `${this._feedbackTitleEl.textContent} ${this._feedbackSubEl.textContent}`.trim()
      );
    }
    const btnRestart = this._victorySection.querySelector('#btn-restart');
    if (btnRestart) {
      btnRestart.querySelector('.btn-modal-label').textContent = i18n.t('ui.play_again');
      btnRestart.setAttribute('aria-label', i18n.t('ui.play_again'));
    }

    if (this._currentLevel && this._currentLevelParams) {
      const levelNameKey = `ui.level_${this._currentLevelParams.name}`;
      const levelLabel = `${i18n.t('ui.level', this._currentLevel)}: ${i18n.t(levelNameKey)}`;
      this._levelInfoEl.textContent = `${this._currentLevel}`;
      this._levelInfoEl.setAttribute('aria-label', levelLabel);
    }

    if (this._currentInstKey) {
       this._targetEl.textContent = i18n.t(this._currentInstKey);
       this._targetEl.setAttribute('aria-label', this._targetEl.textContent);
    }

    if (this._currentStats) {
       this._scoreEl.textContent = this._currentStats.score;
       this._streakEl.textContent = this._currentStats.streak;
       this._scoreEl.setAttribute('aria-label', `${i18n.t('ui.score')}: ${this._currentStats.score}`);
       this._streakEl.setAttribute('aria-label', i18n.t('ui.streak', this._currentStats.streak));
    }

    if (this._currentProgress) {
       this._progressEl.textContent = `${this._currentProgress.current}/${this._currentProgress.total}`;
       this._progressEl.setAttribute('aria-label', i18n.t('ui.question_of', this._currentProgress.current, this._currentProgress.total));
    }

    if (this._finalStats) {
      this._victorySection.querySelector('#val-avg-time').textContent = formatSeconds(
        this._finalStats.avgTime / 1000
      );
    }

    if (this._transitionSection.style.display === 'flex') {
      if (this._transitionPassed) {
        this._transitionSection.querySelector('#transition-title').textContent = i18n.t('ui.level_complete');
        this._transitionSection.querySelector('#transition-subtitle').textContent = '';
      } else {
        this._transitionSection.querySelector('#transition-title').textContent = i18n.t('ui.level_failed');
        if (this._currentLevelParams?.comboRequirement > 0 && this._currentStats?.levelAnswered >= 3 && this._currentStats?.levelBestStreak < this._currentLevelParams.comboRequirement) {
          this._transitionSection.querySelector('#transition-subtitle').textContent = i18n.t('ui.combo_needed', this._currentLevelParams.comboRequirement);
        } else {
          this._transitionSection.querySelector('#transition-subtitle').textContent = '';
        }
      }
      if (this._unlockedLevel) {
          this._transitionSection.querySelector('#transition-subtitle').textContent = i18n.t('ui.level_unlocked', this._unlockedLevel);
      }
    }
  }

  dispose() {
    eventBus.off('game:stateChange', this._onGameStateChange);
    eventBus.off('level:start', this._onLevelStart);
    eventBus.off('level:complete', this._onLevelComplete);
    eventBus.off('level:unlocked', this._onLevelUnlocked);
    eventBus.off('game:newQuestion', this._onGameNewQuestion);
    eventBus.off('detection:progress', this._onDetectionProgress);
    eventBus.off('game:hit', this._onGameHit);
    eventBus.off('game:miss', this._onGameMiss);
    eventBus.off('game:complete', this._onGameComplete);
    eventBus.off('game:pauseChange', this._onGamePauseChange);
    eventBus.off('i18n:change', this._onI18nChange);

    if (this._btnRestart) {
      this._btnRestart.removeEventListener('click', this._onRestartClick);
    }

    this._stopTimer();

    if (this._container) {
      this._container.innerHTML = '';
    }
  }
}
