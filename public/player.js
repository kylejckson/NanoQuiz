// public/player.js
const socket = io();
const byId = id => document.getElementById(id);
// Utility to get element by ID
const el = {
  join: byId('join'),
  name: byId('name'),
  joinBtn: byId('joinBtn'),
  joinMsg: byId('joinMsg'),
  waiting: byId('waiting'),
  waitingGame: byId('waitingGame'),
  play: byId('play'),
  qText: byId('qText'),
  qImage: byId('qImage'),
  answers: byId('answers'),
  qIndex: byId('qIndex'),
  qTotal: byId('qTotal'),
  status: byId('status'),
  timer: null, 
  music: byId('music'),
  reveal: byId('reveal'),
  leaderboard: byId('leaderboard'),
  board: byId('board'),
  over: byId('over'),
  finalBoard: byId('finalBoard'),
  backToJoinBtn: document.getElementById('backToJoinBtn')
};

// Global answer styles (color and shape)
const GLOBAL_ANSWER_STYLES = [
  { color: 'red',    shape: '■' },
  { color: 'blue',   shape: '♦' },
  { color: 'yellow', shape: '●' },
  { color: 'green',  shape: '▲' }
];

// Get game ID from URL
const params = new URLSearchParams(location.search);
const gameId = params.get('game');
let currentQuestionId = null;
let lockedOptionId = null;

// Handle join button
el.joinBtn.addEventListener('click', () => {
  const name = el.name.value.trim();
  if (!name) {
    el.joinMsg.textContent = 'Enter a name.';
    return;
  }
  socket.emit('player:join', { gameId, name }, (res) => {
    if (!res?.ok) {
      el.joinMsg.textContent = res?.error || 'Unable to join.';
      return;
    }
    el.join.classList.add('hidden');
    el.waiting.classList.remove('hidden');
    el.waitingGame.textContent = `Game ID: ${gameId}`;
  });
});

// Add timer element after status in the DOM (if not present)
if (!document.getElementById('timer')) {
  const timerDiv = document.createElement('div');
  timerDiv.id = 'timer';
  timerDiv.className = 'muted';
  el.status.parentNode.insertBefore(timerDiv, el.status.nextSibling);
  el.timer = timerDiv;
} else {
  el.timer = document.getElementById('timer');
}

// Countdown timer functions
function startCountdown(seconds) {
  clearCountdown();
  countdownEndTime = Date.now() + seconds * 1000;
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 200);
}

// Update countdown display
function updateCountdown() {
  if (!countdownEndTime) return;
  const msLeft = countdownEndTime - Date.now();
  const secLeft = Math.max(0, Math.ceil(msLeft / 1000));
  el.timer.textContent = `Time left: ${secLeft}s`;
  if (msLeft <= 0) {
    clearCountdown();
  }
}

let countdownInterval = null;
let countdownEndTime = null;

// Clear countdown
function clearCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  el.timer.textContent = '';
  countdownEndTime = null;
}

// Game started
socket.on('game:started', () => {
  el.waiting.classList.add('hidden');
  el.leaderboard.classList.add('hidden'); // ensure hidden at start
  el.over.classList.add('hidden');
  el.play.classList.remove('hidden');
});

// Shuffle array utility
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// New question
socket.on('question:show', (q) => {
  // Reset UI
  currentQuestionId = q.id;
  lockedOptionId = null;
  el.status.textContent = '';

  // Hide leaderboard during question phase
  el.leaderboard.classList.add('hidden'); // ensure leaderboard is hidden at start of question

  el.qText.textContent = q.text;
  el.qIndex.textContent = (q.index + 1);
  el.qTotal.textContent = q.total;

  if (q.imageUrl) {
    el.qImage.src = q.imageUrl;
    el.qImage.classList.remove('hidden');
  } else {
    el.qImage.classList.add('hidden');
  }

  el.answers.innerHTML = '';
  // Assign global color/shape (do NOT randomize order)
  let options = q.options.map((opt, idx) => ({
    ...opt,
    color: GLOBAL_ANSWER_STYLES[idx % GLOBAL_ANSWER_STYLES.length].color,
    shape: GLOBAL_ANSWER_STYLES[idx % GLOBAL_ANSWER_STYLES.length].shape
  }));
  // Do NOT shuffle options
  window._lastOptionIdOrder = options.map(opt => opt.id);

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = `answer ${opt.color}`;
    btn.innerHTML = `<span class="shape">${opt.shape}</span> <span class="label">${opt.label}</span>`;
    btn.dataset.id = opt.id; // assign option id for later lookup
    btn.addEventListener('click', () => {
      if (lockedOptionId) return;
      lockedOptionId = opt.id;
      socket.emit('player:answer', { gameId, questionId: currentQuestionId, optionId: opt.id });
      // Provide immediate “locked” feedback
      [...el.answers.children].forEach(b => b.disabled = true);
      btn.classList.add('locked');
      el.status.textContent = 'Answer locked. Waiting…';
    });
    el.answers.appendChild(btn);
  });

  // Start music
  try { el.music.currentTime = 0; el.music.play(); } catch {}

  clearCountdown();
  if (q.timeLimitSeconds) startCountdown(q.timeLimitSeconds);
});

// Question reveal
socket.on('question:reveal', ({ correctOptionIds, leaderboard, counts }) => {
  // Stop music, play reveal
  try { el.music.pause(); } catch {}
  try { el.reveal.currentTime = 0; el.reveal.play(); } catch {}

  // Ensure all ids are strings for comparison
  const correctIds = (correctOptionIds || []).map(String);
  const lockedId = lockedOptionId ? String(lockedOptionId) : null;
  const gotCorrect = lockedId && correctIds.includes(lockedId);

  document.body.classList.toggle('correct-bg', !!gotCorrect);
  document.body.classList.toggle('wrong-bg', lockedOptionId && !gotCorrect);

  el.status.textContent = '';

  // Map optionId to count for correct badge placement
  let optionIdToCount = {};
  if (Array.isArray(counts) && el.answers.children.length === counts.length) {
    // Get the optionId for each button in the original order
    // But since options are shuffled, we need to get the mapping from the question
    // Instead, send the mapping from the server, but since we don't have it, we use the DOM order
    // So, fallback: use the DOM order, but this is only correct if the server and client use the same order
    // To fix: store the mapping of optionId to count in the order of the current question's options
    // But since we don't have the original options order here, we need to get it from the DOM
    // So, instead, on reveal, send also the optionIds array in order from the server
    // But for now, let's map by optionId
    [...el.answers.children].forEach((btn, idx) => {
      optionIdToCount[btn.dataset.id] = 0;
    });
    // The server sends counts in the order of the original options array
    // But the client has shuffled the options, so we need to know the original optionIds order
    // To fix this, we need the server to send optionIds in order with counts
    // For now, as a workaround, we can skip showing counts if the mapping is ambiguous
    // But let's try to fix it by storing the mapping when showing the question

    // Use a global variable to store the mapping from optionId to count
    if (window._lastOptionIdOrder && Array.isArray(counts)) {
      window._lastOptionIdOrder.forEach((optionId, idx) => {
        optionIdToCount[optionId] = counts[idx] || 0;
      });
    }
  }

  [...el.answers.children].forEach((btn, idx) => {
    const optId = String(btn.dataset.id);
    btn.classList.remove('correct', 'wrong', 'player-correct', 'player-wrong', 'player-reveal-correct');
    if (gotCorrect) {
      if (correctIds.includes(optId)) {
        btn.classList.add('player-correct');
      } else {
        btn.classList.add('wrong');
      }
    } else {
      if (lockedId && optId === lockedId && !correctIds.includes(optId)) {
        btn.classList.add('wrong');
      }
      if (correctIds.includes(optId)) {
        btn.classList.add('player-reveal-correct');
      } else if (optId !== lockedId) {
        btn.classList.add('wrong');
      }
    }
    // Add count badge (use correct mapping)
    if (optionIdToCount && optId in optionIdToCount) {
      let count = optionIdToCount[optId] || 0;
      let badge = btn.querySelector('.answer-count-badge');
      if (badge) badge.remove();
      const badgeEl = document.createElement('span');
      badgeEl.className = 'answer-count-badge';
      badgeEl.textContent = count;
      badgeEl.style.cssText = 'margin-left:8px;background:#222;color:#fff;border-radius:10px;padding:2px 8px;font-size:0.95em;';
      btn.appendChild(badgeEl);
    }
  });

  // Leaderboard
  el.board.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    // Show score and delta if delta > 0
    let scoreText = `${p.name} - ${p.score.toLocaleString()}`;
    if (typeof p.delta === 'number' && p.delta > 0) {
      scoreText += ` (+${p.delta})`;
    }
    li.textContent = scoreText;
    if (p.lastCorrect) li.classList.add('correctish');
    el.board.appendChild(li);
  });
  el.leaderboard.classList.remove('hidden'); // ensure leaderboard is shown on reveal

  // Fade feedback after short delay
  setTimeout(() => {
    document.body.classList.remove('correct-bg', 'wrong-bg');
  }, 4500);

  clearCountdown();
});

// Game Over
socket.on('game:over', ({ leaderboard }) => {
  el.play.classList.add('hidden');
  el.leaderboard.classList.add('hidden');
  el.over.classList.remove('hidden');
  el.finalBoard.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    // Show score and delta if delta > 0
    let scoreText = `#${i + 1} ${p.name} — ${p.score.toLocaleString()}`;
    if (typeof p.delta === 'number' && p.delta > 0) {
      scoreText += ` (+${p.delta})`;
    }
    li.textContent = scoreText;
    el.finalBoard.appendChild(li);
  });

  // Play end sound effect
  const endAudio = document.getElementById('end');
  if (endAudio) {
    try { endAudio.currentTime = 0; endAudio.play(); } catch {}
  }

  clearCountdown();
});

if (el.backToJoinBtn) {
  el.backToJoinBtn.addEventListener('click', () => {
    window.location.href = '/join.html';
  });
}

const origAddEventListener = EventTarget.prototype.addEventListener;

socket.on('game:over', ({ leaderboard }) => {
  el.play.classList.add('hidden');
  el.leaderboard.classList.add('hidden');
  el.over.classList.remove('hidden');
  el.finalBoard.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `#${i + 1} ${p.name} — ${p.score}`;
    el.finalBoard.appendChild(li);
  });
});

